import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebaseService';
import type { Attachment } from '../types';

const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.72;
/** Parallel Storage uploads (keeps older phones stable). */
const UPLOAD_CONCURRENCY = 3;

const resolveMimeType = (file: File): string => {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.rtf')) return 'text/rtf';
  if (name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (name.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
};

/** Largest file the AI request can carry (a request body is capped near 20 MB, base64 adds a third). */
const MAX_DOC_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Photos are shrunk before sending, so a bigger original is fine. */
const MAX_IMAGE_UPLOAD_BYTES = 40 * 1024 * 1024;

/**
 * Catch a file that can never be analysed before the advocate waits for it.
 * Returns a message to show, or null when the file is fine.
 */
export const validateUploadFile = (file: File, language: string): string | null => {
  const hi = language === 'Hindi';
  if (!file || file.size <= 0) {
    return hi ? `"${file?.name || 'फ़ाइल'}" खाली है। कृपया सही फ़ाइल चुनें।` : `"${file?.name || 'File'}" is empty. Please pick a valid file.`;
  }
  const mime = resolveMimeType(file);
  const isImage = mime.startsWith('image/');
  if (mime === 'application/octet-stream') {
    return hi
      ? `"${file.name}" इस प्रकार की फ़ाइल समर्थित नहीं है। PDF, DOCX, DOC, TXT, RTF या फ़ोटो (JPG/PNG) अपलोड करें।`
      : `"${file.name}" is not a supported file type. Upload a PDF, DOCX, DOC, TXT, RTF or a photo (JPG/PNG).`;
  }
  if (isImage ? file.size > MAX_IMAGE_UPLOAD_BYTES : file.size > MAX_DOC_UPLOAD_BYTES) {
    const mb = Math.round((isImage ? MAX_IMAGE_UPLOAD_BYTES : MAX_DOC_UPLOAD_BYTES) / 1048576);
    return hi
      ? `"${file.name}" बहुत बड़ी है (अधिकतम ${mb} MB)। फ़ाइल को कम पन्नों में बाँटकर अपलोड करें।`
      : `"${file.name}" is too large (max ${mb} MB). Split it into fewer pages and upload again.`;
  }
  return null;
};

const isImageFile = (file: File): boolean =>
  resolveMimeType(file).startsWith('image/');

const compressViaImageElement = (
  file: File,
  maxEdge: number,
  quality: number
): Promise<File> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              resolve(file);
              return;
            }
            const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
            resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality
        );
      } catch {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });

export type CompressOpts = {
  maxEdge?: number;
  quality?: number;
  skipBelow?: number;
  onProgress?: (done: number, total: number, name: string) => void;
};

/** Shrink large photos so many uploads fit Gemini + Storage (works on older Android too). */
export const compressImageIfNeeded = async (file: File, opts?: CompressOpts): Promise<File> => {
  if (!isImageFile(file)) return file;
  const maxEdge = opts?.maxEdge ?? MAX_IMAGE_EDGE;
  const quality = opts?.quality ?? JPEG_QUALITY;
  const skipBelow = opts?.skipBelow ?? 350_000;
  if (file.size < skipBelow) return file;

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return compressViaImageElement(file, maxEdge, quality);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
      );
      if (!blob) return compressViaImageElement(file, maxEdge, quality);
      const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    }
    return compressViaImageElement(file, maxEdge, quality);
  } catch {
    try {
      return await compressViaImageElement(file, maxEdge, quality);
    } catch {
      return file;
    }
  }
};

/** Compress many files with limited concurrency (avoids OOM on low-RAM phones). */
export const prepareFilesForAi = async (files: File[], opts?: CompressOpts): Promise<File[]> => {
  const out: File[] = new Array(files.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length || 1) }, async () => {
    while (next < files.length) {
      const i = next++;
      out[i] = await compressImageIfNeeded(files[i], opts);
      done += 1;
      opts?.onProgress?.(done, files.length, files[i]?.name || '');
    }
  });
  await Promise.all(workers);
  return out;
};

const safeFileName = (name: string): string =>
  name
    .replace(/\.\./g, '_')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .slice(0, 120);

export type UploadProgress = (done: number, total: number, fileName: string) => void;

const runPool = async <T,>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) => {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
};

/**
 * Upload prepared (already compressed) files to Firebase Storage in parallel.
 * Failures do not throw — attachments without url are still returned.
 */
export const uploadPreparedAttachments = async (
  preparedFiles: File[],
  originalNames: string[],
  type: 'case' | 'format',
  sessionId: string,
  onProgress?: UploadProgress
): Promise<{ attachments: Attachment[]; cloudSaved: boolean }> => {
  let uid = auth.currentUser?.uid;
  if (!uid) {
    uid = await new Promise<string | undefined>((resolve) => {
      const timer = window.setTimeout(() => resolve(auth.currentUser?.uid || undefined), 2500);
      const unsub = auth.onAuthStateChanged((user) => {
        if (user?.uid) {
          window.clearTimeout(timer);
          unsub();
          resolve(user.uid);
        }
      });
    });
  }
  const attachments: Attachment[] = new Array(preparedFiles.length);
  let cloudSaved = true;
  let done = 0;

  if (!uid) {
    preparedFiles.forEach((prepared, i) => {
      attachments[i] = {
        name: originalNames[i] || prepared.name,
        type,
        mimeType: resolveMimeType(prepared),
        size: prepared.size,
      };
    });
    onProgress?.(preparedFiles.length, preparedFiles.length, '');
    return { attachments, cloudSaved: false };
  }

  await runPool(preparedFiles, UPLOAD_CONCURRENCY, async (prepared, i) => {
    const mimeType = resolveMimeType(prepared);
    const displayName = originalNames[i] || prepared.name;
    try {
      const path = `users/${uid}/chats/${sessionId}/${Date.now()}_${i}_${safeFileName(prepared.name)}`;
      const storageRef = ref(storage, path);
      const tryUpload = async () => {
        await uploadBytes(storageRef, prepared, { contentType: mimeType });
        // Tokenized download URLs are long-lived; Storage rules still require
        // the owner to mint a new URL. Existing chats keep working as before.
        return getDownloadURL(storageRef);
      };
      let url: string;
      try {
        url = await tryUpload();
      } catch {
        await new Promise((r) => setTimeout(r, 400));
        url = await tryUpload();
      }
      attachments[i] = {
        name: displayName,
        type,
        url,
        storagePath: path,
        mimeType,
        size: prepared.size,
      };
    } catch (err) {
      console.warn('Storage upload failed; continuing with local analysis', displayName, err);
      cloudSaved = false;
      attachments[i] = {
        name: displayName,
        type,
        mimeType,
        size: prepared.size,
      };
    } finally {
      done += 1;
      onProgress?.(done, preparedFiles.length, displayName);
    }
  });

  onProgress?.(preparedFiles.length, preparedFiles.length, '');
  return { attachments, cloudSaved };
};

/**
 * Compress + upload. Prefer prepareFilesForAi + uploadPreparedAttachments when
 * analysis should run in parallel with cloud save.
 */
export const uploadChatAttachments = async (
  files: File[],
  type: 'case' | 'format',
  sessionId: string,
  onProgress?: UploadProgress
): Promise<{ attachments: Attachment[]; filesForAi: File[]; cloudSaved: boolean }> => {
  const filesForAi = await prepareFilesForAi(files);
  const { attachments, cloudSaved } = await uploadPreparedAttachments(
    filesForAi,
    files.map((f) => f.name),
    type,
    sessionId,
    onProgress
  );
  return { attachments, filesForAi, cloudSaved };
};

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
  });

export const resolveMimeTypeFromName = (file: File): string => resolveMimeType(file);

/** Fetch a previously saved attachment as a File for Gemini. */
export const fetchAttachmentAsFile = async (att: Attachment): Promise<File | null> => {
  if (!att.url) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = att.mimeType || blob.type || 'application/octet-stream';
    return new File([blob], att.name || 'attachment', { type: mime });
  } catch (e) {
    console.warn('Could not reload attachment', att.name, e);
    return null;
  }
};
