import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';

const base64ToFile = (base64: string, name: string, mimeType: string): File => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, {
    type: mimeType || 'application/octet-stream',
    lastModified: Date.now(),
  });
};

const pickedToFile = async (f: any, idx: number): Promise<File | null> => {
  const name = f.name || `file_${Date.now()}_${idx}`;
  const mime = f.mimeType || 'application/octet-stream';
  try {
    if (f.blob instanceof Blob && f.blob.size > 0) {
      return new File([f.blob], name, { type: mime, lastModified: Date.now() });
    }
    if (f.path) {
      const url = Capacitor.convertFileSrc(f.path);
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) return new File([blob], name, { type: mime || blob.type, lastModified: Date.now() });
      }
    }
    if (typeof f.data === 'string' && f.data.length > 0) {
      return base64ToFile(f.data, name, mime);
    }
  } catch (e) {
    console.warn('Could not read picked file', name, e);
  }
  return null;
};

export type PickProgress = {
  done: number;
  total: number;
  name?: string;
  file?: File;
};

/**
 * Native multi-file picker. Reads one file at a time so large case photo
 * sets do not crash the WebView. Compression happens later, at send time.
 */
export const pickMultipleNativeFiles = async (
  onProgress?: (info: PickProgress) => void
): Promise<File[] | null> => {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    let result: any;
    try {
      result = await FilePicker.pickFiles({
        limit: 0,
        readData: false,
      });
    } catch {
      result = await FilePicker.pickFiles({
        limit: 0,
        readData: true,
      });
    }

    if (!result.files?.length) return [];

    const total = result.files.length;
    onProgress?.({ done: 0, total });
    const files: File[] = [];
    for (let i = 0; i < total; i++) {
      const raw = await pickedToFile(result.files[i], i);
      if (raw && raw.size > 0) {
        files.push(raw);
        onProgress?.({
          done: i + 1,
          total,
          name: raw.name,
          file: raw,
        });
      } else {
        onProgress?.({
          done: i + 1,
          total,
          name: result.files[i]?.name,
        });
      }
    }
    return files;
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/cancel/i.test(msg)) return [];
    console.error('Native file pick failed', e);
    throw e;
  }
};

export const isNativeApp = () => Capacitor.isNativePlatform();
