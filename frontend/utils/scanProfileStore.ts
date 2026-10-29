/**
 * Device-local storage for scanned-template work:
 *   profiles : the analysed (and possibly advocate-corrected) TemplateProfile, keyed by the hash of the uploaded file
 *   images   : the straightened page images the profile's coordinates refer to (the original file is never changed)
 *   drafts   : for each generated message, the draft, its DOCX and what is needed to make the PDF again
 *
 * IndexedDB with an in-memory copy. Nothing here is sent to any server.
 */
import type { TemplateProfile } from './scanTemplate.ts';
import type { Draft } from './scanReconstruct.ts';

const DB_NAME = 'casemate-scan-templates';
const DB_VERSION = 1;

export interface StoredScanDraft {
  /** chat message id */
  id: string;
  profileId: string;
  draft: Draft;
  docx: Uint8Array;
  /** editor text exactly as generated, used to notice later edits */
  baseText: string;
  fileName: string;
  review: string[];
  /** automatic checks on the DOCX, shown in the template check panel */
  checks: { name: string; ok: boolean; detail: string }[];
}

const profiles = new Map<string, TemplateProfile>();
const images = new Map<string, Blob[]>();
const drafts = new Map<string, StoredScanDraft>();

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('images', { keyPath: 'id' });
        db.createObjectStore('drafts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

const put = async (store: string, value: any): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
};

const get = async <T,>(store: string, id: string): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  const found = await new Promise<T | null>((resolve) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id);
    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return found;
};

export const getProfile = async (id: string): Promise<TemplateProfile | null> => {
  const cached = profiles.get(id);
  if (cached) return cached;
  const found = await get<TemplateProfile>('profiles', id);
  if (found) profiles.set(id, found);
  return found;
};

export const saveProfile = async (profile: TemplateProfile): Promise<void> => {
  profiles.set(profile.id, profile);
  await put('profiles', profile);
};

export const savePageImages = async (profileId: string, blobs: Blob[]): Promise<void> => {
  images.set(profileId, blobs);
  await put('images', { id: profileId, blobs });
};

export const getPageImages = async (profileId: string): Promise<Blob[] | null> => {
  const cached = images.get(profileId);
  if (cached) return cached;
  const found = await get<{ id: string; blobs: Blob[] }>('images', profileId);
  if (found?.blobs?.length) images.set(profileId, found.blobs);
  return found?.blobs?.length ? found.blobs : null;
};

export const saveScanDraft = async (record: StoredScanDraft): Promise<void> => {
  drafts.set(record.id, record);
  await put('drafts', record);
};

const asBytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  return new Uint8Array(0);
};

export const getScanDraft = async (id: string): Promise<StoredScanDraft | null> => {
  const cached = drafts.get(id);
  if (cached) return { ...cached, docx: asBytes(cached.docx) };
  const found = await get<StoredScanDraft>('drafts', id);
  if (!found) return null;
  const record = { ...found, docx: asBytes(found.docx) };
  drafts.set(id, record);
  return record;
};
