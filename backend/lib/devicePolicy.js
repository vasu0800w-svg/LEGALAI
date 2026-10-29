/**
 * Per-install device ids are client-generated. They are not hardware proof.
 * Missing or malformed ids must not skip the device-slot check.
 */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const parseDeviceId = (value) => {
  const id = String(value || '').trim();
  if (!DEVICE_ID_RE.test(id)) return null;
  return id;
};
