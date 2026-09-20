import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.readAsDataURL(blob);
  });

/** Save a Blob on native (Share sheet) or trigger browser download on web. */
export async function saveBlobFile(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const safeName = filename.replace(/[^\w.\-]+/g, '_');
    const written = await Filesystem.writeFile({
      path: safeName,
      data: base64,
      directory: Directory.Cache,
    });

    try {
      await Share.share({
        title: safeName,
        url: written.uri,
        dialogTitle: 'Save or share document',
      });
    } catch (err) {
      // User cancelled share sheet — file is still in cache
      console.info('Share dismissed or unavailable', err);
    }
    return;
  }

  const typed = blob.type ? blob : new Blob([blob], { type: 'application/pdf' });
  const file = new File([typed], filename, { type: typed.type || 'application/pdf' });
  const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(typed);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Mobile Chrome may open the blob in a viewer — do not revoke immediately
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Share plain text via native share sheet, Web Share API, or clipboard. */
export async function sharePlainText(text: string, title = 'casemate'): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text: trimmed, dialogTitle: title });
    } catch (err) {
      console.info('Share dismissed or unavailable', err);
    }
    return;
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: trimmed });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(trimmed);
  } catch (err) {
    console.info('Clipboard copy unavailable', err);
  }
}
