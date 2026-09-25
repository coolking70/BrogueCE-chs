/** Whole runs exceed localStorage's small string quota. One IndexedDB transaction
 * commits the JSON checkpoint and menu summary together, including on overwrite. */
import { WHOLE_RUN_SCHEMA, type GameSnapshot, type GameMode } from './Game';

export interface SaveSummary {
    schema: typeof WHOLE_RUN_SCHEMA;
    depth: number;
    seed: string;
    mode: GameMode;
    savedAt: number;
}

async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('brogue-web-saves', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('checkpoint');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Save database upgrade is blocked'));
    });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction('checkpoint', mode);
            const request = action(tx.objectStore('checkpoint'));
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error ?? request.error);
            tx.onerror = () => reject(tx.error ?? request.error);
        });
    } finally { db.close(); }
}

export async function saveSnapshot(snapshot: GameSnapshot): Promise<SaveSummary> {
    const summary: SaveSummary = { schema: snapshot.schema, depth: snapshot.depth, seed: snapshot.seed,
        mode: snapshot.mode, savedAt: snapshot.savedAt };
    // Materialize JSON before the first await: the simulation may resume while
    // IndexedDB opens, and callers can hold Vue proxies.
    const json = JSON.stringify(snapshot);
    await transaction('readwrite', store => {
        store.put(json, 'world');
        return store.put(summary, 'summary');
    });
    return summary;
}

export async function readSaveSummary(): Promise<SaveSummary | null> {
    const summary = await transaction<SaveSummary | undefined>('readonly', store => store.get('summary'));
    return summary?.schema === WHOLE_RUN_SCHEMA ? summary : null;
}

export async function readSnapshot(): Promise<GameSnapshot | null> {
    const json = await transaction<string | undefined>('readonly', store => store.get('world'));
    return json === undefined ? null : JSON.parse(json) as GameSnapshot;
}

export async function deleteSnapshot(): Promise<void> {
    await transaction('readwrite', store => store.clear());
}
