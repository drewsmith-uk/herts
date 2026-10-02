import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from './store.js';

/** Durable cleanup survives a crash between erasing a message and removing bytes. */
export function discardedUploads(store: Store, directory: string, locks: Set<string>) {
  let running: Promise<void> | undefined, again = false;
  return () => {
    if (running) { again = true; return running; }
    return running = (async () => {
      let failure: unknown;
      do {
        again = false;
        for (const { id } of store.db.prepare('SELECT id FROM discarded_uploads').all() as { id: string }[]) {
          if (locks.has(id)) continue;
          // Only UUID upload filenames are ever eligible; do not follow stored paths.
          if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) continue;
          const referenced = store.db.prepare("SELECT 1 FROM actions a, json_each(a.data, '$.uploadIds') u WHERE u.value=? LIMIT 1").get(id);
          if (referenced) { store.db.prepare('DELETE FROM discarded_uploads WHERE id=?').run(id); continue; }
          locks.add(id);
          try {
            store.db.prepare('DELETE FROM uploads WHERE id=?').run(id);
            await rm(join(directory, id), { force: true });
            await rm(join(directory, id + '.part'), { force: true });
            store.db.prepare('DELETE FROM discarded_uploads WHERE id=?').run(id);
          } catch (error) { failure ??= error; }
          finally { locks.delete(id); }
        }
      } while (again);
      if (failure) throw failure;
    })().finally(() => { running = undefined; });
  };
}
