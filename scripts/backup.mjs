import Database from 'better-sqlite3';
import { mkdir, cp, chmod } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
process.umask(0o077);
const data = resolve(process.env.HERTS_DATA_DIR ?? process.env.TASKS_DATA_DIR ?? 'data');
const destination = process.argv[2];
if (!destination) throw new Error('Supply an empty, private backup directory outside data/.');
const target = resolve(destination);
if (target === data || target.startsWith(data + '/')) throw new Error('Backup must be outside the live data directory.');
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await mkdir(target, { mode: 0o700 });
const db = new Database(join(data, 'tasks.sqlite'), { readonly: true });
await db.backup(join(target, 'tasks.sqlite')); db.close();
await cp(join(data, 'uploads'), join(target, 'uploads'), { recursive: true, filter: path => !path.endsWith('.part') });
for (const name of ['app.env', 'backend.env', 'backend-token']) { try { await cp(join(data, name), join(target, name)); await chmod(join(target, name), 0o600); } catch(e) { if (e.code !== 'ENOENT') throw e; } }
console.log('Private backup complete. Incomplete upload chunks remain recoverable from their original devices.');
