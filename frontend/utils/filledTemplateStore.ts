/**
 * Keeps the template-faithful .docx that was filled for a generated document, so
 * "Download DOCX" can hand back the advocate's own template instead of a rebuilt one.
 * Held in memory for this session and in IndexedDB so it survives a reload.
 */
const DB_NAME = 'casemate-filled-templates';
const STORE = 'files';

export interface StoredFilledTemplate {
  id: string;
  docx: Uint8Array;
  /** the document text exactly as it was when generated, used to notice later edits */
  baseText: string;
  fileName: string;
}

const memory = new Map<string, StoredFilledTemplate>();

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

export const saveFilledTemplate = async (id: string, docx: Uint8Array, baseText: string, fileName: string): Promise<void> => {
  const record: StoredFilledTemplate = { id, docx, baseText, fileName };
  memory.set(id, record);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
};

export const getFilledTemplate = async (id: string): Promise<StoredFilledTemplate | null> => {
  const cached = memory.get(id);
  if (cached) return cached;
  const db = await openDb();
  if (!db) return null;
  const found = await new Promise<StoredFilledTemplate | null>((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredFilledTemplate) || null);
    req.onerror = () => resolve(null);
  });
  db.close();
  if (found) memory.set(id, found);
  return found;
};

/** Words only: formatting tags and spacing are ignored so only real text edits count. */
export const plainForCompare = (text: string): string =>
  String(text || '')
    .replace(/\[\/?(?:CENTER|RIGHT|LEFT|JUSTIFY|ROW|U|B|I|LOGO(?::\d+)?)\]/gi, '')
    .replace(/\*+/g, '')
    .replace(/[|\s\u00a0\u200b]+/g, '')
    .toLowerCase();
