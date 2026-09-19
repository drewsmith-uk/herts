import { readdir, readFile, mkdir, cp, rm, writeFile, realpath, stat, rename } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fetchArticleHtml, extractArticle } from '../publicWeb.js';
import type { Store } from '../store.js';
import type { Gateway } from '../gateway.js';
import type { ActivateServer, ServerPlugin, ServerServices } from '../../sdk/server.js';
import { PLUGIN_API_VERSION, type PluginManifest, type PluginCatalogue, type PluginEntry, type PluginOperation } from '../../shared/plugins.js';
import { legacyReceipt } from './migration.js';
import { PluginStorage, PluginError } from './storage.js';
const manifestSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).refine(id => id !== 'conversations' && !id.startsWith('invalid-')), name: z.string().min(1).max(80), description: z.string().max(2000), version: z.string().min(1).max(80), apiVersion: z.number().int().positive(), schemaVersion: z.number().int().nonnegative(), routes: z.array(z.string().regex(/^\/[a-z][a-z0-9-]*$/)).optional(), shortcuts: z.array(z.object({ name: z.string(), description: z.string(), url: z.string().startsWith('/') })).optional(), client: z.string().optional(), server: z.string().optional(), icon: z.string().max(80).optional() }).strict().refine(m => !!(m.client || m.server));
const reservedRoutes = new Set(['/conversations', '/conversation', '/new', '/draft', '/settings', '/share', '/notice', '/plugins', '/plugins-unavailable']);
const packageFile = (name: string) => name !== 'src' && !name.startsWith('.');
async function packageHash(root: string) {
    const hash = createHash('sha256');
    async function walk(dir: string) {
        for (const file of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!packageFile(file.name))
                continue;
            if (file.isSymbolicLink())
                throw new Error('Prepared packages must not contain symbolic links.');
            const path = join(dir, file.name);
            if (file.isDirectory())
                await walk(path);
            else if (file.isFile())
                hash.update(relative(root, path)).update('\0').update(await readFile(path)).update('\0');
        }
    }
    await walk(root);
    return hash.digest('hex');
}
async function bounded<T>(work: Promise<T>, message: string, ms = 10000): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); timer.unref(); })]);
    }
    finally {
        clearTimeout(timer);
    }
}
interface Saved extends PluginEntry {
    paused?: boolean;
}
interface Package {
    manifest: PluginManifest;
    hash: string;
    path: string;
}
interface Runtime {
    definition: ServerPlugin;
    controller: AbortController;
    cleanup: (() => void)[];
    hash: string;
    services?: ServerServices;
}
export class PluginRegistry {
    readonly storage: PluginStorage;
    readonly web = { fetchHtml: fetchArticleHtml, extractArticle };
    private entries = new Map<string, Saved>();
    private packages = new Map<string, Package>();
    private runtimes = new Map<string, Runtime>();
    private order: string[] = ['conversations'];
    private revision = 0;
    private queue: Promise<unknown> = Promise.resolve();
    private fileOperations = new Map<string, Promise<unknown>>();
    constructor(readonly store: Store, readonly gateway: Gateway, readonly directory: string, readonly dataDirectory: string) {
        this.storage = new PluginStorage(store);
        const saved = store.getMeta<PluginCatalogue>('plugins');
        if (saved) {
            this.entries = new Map(saved.entries.map(e => [e.manifest.id, e]));
            this.order = saved.order;
            this.revision = saved.revision;
        }
    }
    serial<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn);
        this.queue = result.catch(() => { });
        return result;
    }
    private async serialFile<T>(path: string, operation: () => Promise<T>): Promise<T> {
        const result = (this.fileOperations.get(path) || Promise.resolve()).catch(() => {}).then(operation);
        this.fileOperations.set(path, result);
        try { return await result; }
        finally { if (this.fileOperations.get(path) === result) this.fileOperations.delete(path); }
    }
    async initialise(legacy: boolean) {
        await this.scan(true);
        if (!this.store.getMeta('plugins-initialised')) {
            if (legacy) {
                this.order = ['tasks', 'conversations', 'reading'];
                for (const id of ['tasks', 'reading']) {
                    const entry = this.entries.get(id);
                    if (entry?.available)
                        entry.enabled = true;
                }
            }
            this.store.setMeta('plugins-initialised', true);
            this.persist();
        }
        for (const [id, entry] of this.entries)
            if (entry.enabled && entry.available)
                await this.activate(id).catch(() => { });
    }
    catalogue(): PluginCatalogue { return { revision: this.revision, order: [...this.order], entries: [...this.entries.values()].map(e => ({ ...e, generation: this.storage.metadata(e.manifest.id).generation })) }; }
    data() { return Object.fromEntries([...this.entries.keys()].map(id => [id, this.storage.data(id)])); }
    enabled(id: string) { return !!this.entries.get(id)?.enabled && this.runtimes.has(id); }
    persist() { this.revision++; this.store.setMeta('plugins', this.catalogue()); this.store.emit('change', { type: 'plugins' }); }
    async scan(startup = false) {
        const found = new Map<string, Package[]>(), invalid = new Set<string>();
        let folders: import('node:fs').Dirent[];
        try {
            folders = await readdir(this.directory, { withFileTypes: true });
        }
        catch (e: any) {
            if (e.code !== 'ENOENT')
                throw e;
            folders = [];
        }
        for (const folder of folders) {
            if (!folder.isDirectory() || folder.name.startsWith('.'))
                continue;
            const path = join(this.directory, folder.name);
            try {
                const manifest = manifestSchema.parse(JSON.parse(await readFile(join(path, 'plugin.json'), 'utf8')));
                for (const entry of [manifest.client, manifest.server].filter(Boolean) as string[])
                    await this.safePath(path, entry);
                if (manifest.routes?.some(route => reservedRoutes.has(route)))
                    throw new Error('Plugin routes cannot replace core screens.');
                const prefixes = [`/plugins/${manifest.id}`, ...(manifest.routes || [])];
                if (manifest.shortcuts?.some(shortcut => !prefixes.some(prefix => shortcut.url === `/#${prefix}` || shortcut.url.startsWith(`/#${prefix}/`))))
                    throw new Error('Shortcuts must open this plugin’s routes.');
                const pkg = { manifest, hash: await packageHash(path), path };
                found.set(manifest.id, [...(found.get(manifest.id) || []), pkg]);
            }
            catch (error: any) {
                // Invalid folders remain visible without importing their code.
                const id = `invalid-${createHash('sha256').update(folder.name).digest('hex').slice(0, 12)}`;
                invalid.add(id);
                this.entries.set(id, { manifest: { id, name: folder.name, description: 'Invalid plugin package', version: '?', apiVersion: 0, schemaVersion: 0 }, generation: 0, enabled: false, available: true, status: 'incompatible', error: error.message });
            }
        }
        for (const id of this.entries.keys())
            if (id.startsWith('invalid-') && !invalid.has(id))
                this.entries.delete(id);
        for (const [id, candidates] of found) {
            const candidate = candidates[0];
            this.packages.set(id, candidate);
            let entry = this.entries.get(id);
            if (!entry) {
                entry = { manifest: candidate.manifest, enabled: false, available: true, generation: this.storage.metadata(id).generation, status: 'available' };
                this.entries.set(id, entry);
            }
            entry.available = true;
            const conflictingRoute = candidate.manifest.routes?.find(route => [...found].some(([other, packages]) => other !== id && packages.some(p => p.manifest.routes?.includes(route))));
            if (candidates.length !== 1 || candidate.manifest.apiVersion !== PLUGIN_API_VERSION || conflictingRoute) {
                if (this.runtimes.has(id))
                    await this.stop(id);
                entry.enabled = false;
                entry.paused = true;
                entry.status = 'incompatible';
                entry.error = candidates.length !== 1 ? 'Duplicate plugin ID. Remove the duplicate folder and rescan.' : conflictingRoute ? `Another plugin also claims ${conflictingRoute}. Resolve the conflict and rescan.` : 'This package requires a different Herts plugin API version.';
                continue;
            }
            if (entry.hash && entry.hash !== candidate.hash) {
                entry.candidateHash = candidate.hash;
                entry.candidateVersion = candidate.manifest.version;
            }
            else {
                entry.manifest = candidate.manifest;
                entry.hash = candidate.hash;
                delete entry.candidateHash;
                delete entry.candidateVersion;
            }
            if (entry.status === 'unavailable' || entry.status === 'incompatible') {
                entry.status = 'available';
                delete entry.error;
            }
        }
        for (const [id, entry] of this.entries)
            if (!found.has(id) && !id.startsWith('invalid-')) {
                if (entry.enabled || this.runtimes.has(id)) {
                    await this.stop(id);
                    entry.paused = true;
                }
                entry.enabled = false;
                entry.available = false;
                entry.status = 'unavailable';
                this.packages.delete(id);
            }
        // After restart, an enabled package stays on its saved immutable version until Update.
        if (!startup)
            this.persist();
    }
    async safePath(root: string, name: string) {
        if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..'))
            throw new PluginError('Invalid package path.', 400);
        const full = await realpath(resolve(root, name)), base = await realpath(root);
        if (!full.startsWith(base + sep) || !(await stat(full)).isFile())
            throw new PluginError('Package entry must be a file inside its folder.', 400);
        return full;
    }
    async activate(id: string, update = false) {
        const entry = this.entries.get(id), candidate = this.packages.get(id);
        if (!entry?.available || !candidate || entry.status === 'incompatible')
            throw new PluginError('This plugin package is unavailable or incompatible.');
        const hash = update ? candidate.hash : entry.hash || candidate.hash;
        const directory = join(this.dataDirectory, 'plugin-packages', id, hash);
        try {
            if (hash === candidate.hash) {
                try {
                    await stat(directory);
                }
                catch (error: any) {
                    if (error.code !== 'ENOENT')
                        throw error;
                    const temporary = directory + '.' + randomUUID();
                    try {
                        await mkdir(temporary, { recursive: true, mode: 0o700 });
                        await cp(candidate.path, temporary, { recursive: true, filter: path => relative(candidate.path, path).split(sep).every(name => !name || packageFile(name)) });
                        if (await packageHash(temporary) !== hash)
                            throw new Error('Package changed during installation. Rescan and try again.');
                        await rename(temporary, directory);
                    }
                    finally {
                        await rm(temporary, { recursive: true, force: true });
                    }
                }
            }
            const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8')));
            await this.stop(id);
            const controller = new AbortController(), cleanup: (() => void)[] = [];
            const runtime: Runtime = { definition: {}, controller, cleanup, hash };
            this.runtimes.set(id, runtime);
            const guard = () => { if (controller.signal.aborted || this.runtimes.get(id) !== runtime)
                throw new PluginError('This plugin is paused. Enable it before continuing.', 423); };
            const generation = this.storage.metadata(id).generation;
            const filePath = (key: string) => join(this.dataDirectory, 'plugin-files', id, String(generation), createHash('sha256').update(key).digest('hex'));
            const services: ServerServices = {
                id, generation, signal: controller.signal, resumed: !!entry.paused, web: this.web,
                get: key => this.storage.get(id, key), entries: prefix => this.storage.entries(id, prefix),
                transaction: fn => this.storage.transaction(id, generation, guard, fn),
                contexts: () => this.store.contexts(), context: id => this.store.context(id),
                resolveConversation: async (key) => { guard(); const c = await this.gateway.conversation(key); guard(); return { link: { key: c.key, storedId: c.id, title: c.title, source: c.source }, aliases: c.aliases }; },
                onChange: fn => { const safe = () => { if (!controller.signal.aborted)
                    try {
                        fn();
                    }
                    catch (e) {
                        void this.fail(id, e);
                    } }; this.store.on('change', safe); const dispose = () => this.store.off('change', safe); cleanup.push(dispose); return dispose; },
                interval: (fn, ms) => {
                    let busy = false;
                    const timer = setInterval(() => { if (busy || controller.signal.aborted)
                        return; busy = true; Promise.resolve().then(fn).catch(e => this.fail(id, e)).finally(() => { busy = false; }); }, Math.max(100, ms));
                    timer.unref();
                    const dispose = () => clearInterval(timer);
                    cleanup.push(dispose);
                    return dispose;
                },
                files: {
                    read: (key) => this.serialFile(filePath(key), async () => { guard(); try {
                        return await readFile(filePath(key));
                    }
                    catch (e: any) {
                        if (e.code === 'ENOENT')
                            return undefined;
                        throw e;
                    } }),
                    write: (key, bytes) => this.serialFile(filePath(key), async () => { guard(); const dir = join(this.dataDirectory, 'plugin-files', id, String(generation)); await mkdir(dir, { recursive: true, mode: 0o700 }); guard(); await writeFile(filePath(key), bytes, { mode: 0o600 }); if (controller.signal.aborted || this.storage.metadata(id).generation !== generation) {
                        await rm(filePath(key), { force: true });
                        guard();
                        throw new PluginError('Plugin data was reset.', 410);
                    } }),
                    remove: (key) => this.serialFile(filePath(key), async () => { guard(); await rm(filePath(key), { force: true }); }),
                },
            };
            runtime.services = services;
            if (manifest.server) {
                const module = await bounded(import(pathToFileURL(await this.safePath(directory, manifest.server)).href), 'Plugin module loading timed out.');
                if (typeof module.default !== 'function')
                    throw new Error('Server entry must export an activation function.');
                runtime.definition = await bounded(Promise.resolve((module.default as ActivateServer)(services)), 'Plugin activation timed out.');
                if (!runtime.definition || typeof runtime.definition !== 'object')
                    throw new Error('Server entry must return a plugin definition.');
            }
            const data = this.storage.metadata(id);
            if (data.schemaVersion > manifest.schemaVersion)
                throw new Error('This package is older than its saved data schema.');
            if (data.schemaVersion < manifest.schemaVersion)
                this.storage.transaction(id, generation, guard, tx => {
                    const migration:unknown = runtime.definition.migrate?.(data.schemaVersion, tx);
                    if(migration && typeof (migration as any).then==='function')throw new Error('Plugin migrations must be synchronous.');
                    this.store.db.prepare('UPDATE plugin_state SET schema_version=? WHERE id=?').run(manifest.schemaVersion, id);
                });
            await bounded(Promise.resolve(runtime.definition.start?.()), 'Plugin startup timed out.');
            entry.manifest = manifest;
            entry.hash = hash;
            entry.enabled = true;
            entry.paused = false;
            entry.status = 'enabled';
            delete entry.error;
            if (entry.candidateHash === hash) {
                delete entry.candidateHash;
                delete entry.candidateVersion;
            }
            if (!this.order.includes(id))
                this.order.push(id);
            this.persist();
        }
        catch (error) {
            await this.fail(id, error);
            throw error;
        }
    }
    async stop(id: string) {
        const runtime = this.runtimes.get(id);
        if (!runtime)
            return;
        this.runtimes.delete(id);
        runtime.controller.abort();
        for (const dispose of runtime.cleanup)
            try {
                dispose();
            }
            catch { /* Continue releasing the remaining managed resources. */ }
        try {
            await bounded(Promise.resolve().then(() => runtime.definition.dispose?.()), 'Plugin cleanup timed out. Managed jobs have been stopped.', 5000);
        }
        catch (error) {
            const entry = this.entries.get(id);
            if (entry)
                entry.error = (error as Error).message;
        }
    }
    async fail(id: string, error: unknown) {
        const entry = this.entries.get(id);
        if (!entry)
            return;
        try {
            await this.stop(id);
        }
        catch { /* Keep management usable after a failed cleanup. */ }
        entry.enabled = false;
        entry.paused = true;
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : 'Plugin failed.';
        this.persist();
    }
    async disable(id: string) {
        const entry = this.entries.get(id);
        if (!entry)
            throw new PluginError('Plugin not found.', 404);
        await this.stop(id);
        entry.enabled = false;
        entry.paused = true;
        entry.status = entry.available ? 'available' : 'unavailable';
        this.persist();
    }
    async reset(id: string, confirmation: string) {
        const entry = this.entries.get(id);
        if (!entry || confirmation !== entry.manifest.name)
            throw new PluginError('Type the plugin name to confirm resetting its data.', 400);
        const enabled = entry.enabled;
        await this.stop(id);
        entry.enabled = false;
        const uploads = this.storage.reset(id);
        for (const upload of uploads)
            for (const suffix of ['', '.part'])
                await rm(join(this.dataDirectory, 'uploads', upload + suffix), { force: true });
        await rm(join(this.dataDirectory, 'plugin-files', id), { recursive: true, force: true });
        entry.generation = this.storage.metadata(id).generation;
        entry.paused = false;
        this.persist();
        if (enabled)
            await this.activate(id);
    }
    reorder(order: string[]) {
        const expected = new Set(['conversations', ...this.entries.keys()].filter(id => id === 'conversations' || !id.startsWith('invalid-')));
        if (order.length !== expected.size || new Set(order).size !== order.length || order.some(id => !expected.has(id)))
            throw new PluginError('Tab order changed. Refresh and try again.');
        this.order = order;
        this.persist();
    }
    async command(id: string, operation: PluginOperation) {
        const runtime = this.runtimes.get(id);
        const generation = this.storage.metadata(id).generation;
        if (operation.generation !== generation)
            throw new PluginError('This plugin was reset. Old changes cannot be restored.', 410);
        if (!this.enabled(id) || !runtime)
            throw new PluginError('This plugin is paused. Its saved changes are retained.', 423);
        const previous = this.storage.receipt(id, generation, operation.id, operation);
        if (previous)
            return previous.value;
        const command = runtime.definition.commands?.[operation.command];
        if (!command)
            throw new PluginError('Unknown plugin command.', 404);
        // Services are supplied to activation; preparation may resolve remote identities.
        const prepared = command.prepare ? await command.prepare(operation.input, runtime.services!) : undefined;
        return this.storage.transaction(id, generation, () => { if (!this.enabled(id) || this.runtimes.get(id) !== runtime)
            throw new PluginError('Plugin changed before the operation could be committed.', 423); }, tx => {
            const previous = this.storage.receipt(id, generation, operation.id, operation);
            if (previous)
                return previous.value;
            const old = generation === 0 ? legacyReceipt(this.store, id, operation.command, operation.input, prepared) : undefined;
            const value = old ?? command.apply(operation.input, tx, prepared);
            this.storage.saveReceipt(id, generation, operation.id, operation, value);
            return value;
        });
    }
    async query(id: string, command: string, input: unknown) {
        const runtime = this.runtimes.get(id);
        if (!this.enabled(id) || !runtime)
            throw new PluginError('This plugin is paused.', 423);
        const query = runtime.definition.queries?.[command];
        if (!query)
            throw new PluginError('Unknown plugin query.', 404);
        return query(input);
    }
    decorateConversation(conversation: import('../../shared/core.js').Conversation) {
        const filters: string[] = [], extensions: Record<string, unknown> = {};
        for (const [id, runtime] of this.runtimes) {
            try {
                const result = runtime.definition.conversationList?.(conversation);
                if (result) {
                    filters.push(...(result.filters || []).map(f => `${id}:${f}`));
                    if (result.data)
                        extensions[id] = result.data;
                }
            }
            catch (e) {
                void this.fail(id, e);
            }
        }
        return { ...conversation, extensions, pluginFilters: filters };
    }
    conversation(id: string) {
        const context = this.store.context(id);
        if (!context)
            return undefined;
        for (const plugin of this.order) {
            const runtime = this.runtimes.get(plugin);
            if (runtime) {
                try {
                    const result = runtime.definition.conversation?.(context);
                    if (result)
                        return result;
                }
                catch (e) {
                    void this.fail(plugin, e);
                }
            }
        }
        return undefined;
    }
    async asset(id: string, hash: string, name: string) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !/^[a-f0-9]{64}$/.test(hash))
            throw new PluginError('Asset not found.', 404);
        const directory = join(this.dataDirectory, 'plugin-packages', id, hash);
        const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8')));
        if (name !== manifest.client && !name.startsWith('assets/'))
            throw new PluginError('Asset not found.', 404);
        return this.safePath(directory, name);
    }
    async close() { for (const id of this.runtimes.keys())
        try {
            await this.stop(id);
        }
        catch { /* Managed resources and storage leases are already stopped. */ } }
}
