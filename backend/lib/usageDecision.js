/** Pure usage-limit decision used inside the Firestore transaction. */
export const DEVICE_STALE_DAYS = 14;
export const DEVICE_STALE_MS = DEVICE_STALE_DAYS * 24 * 60 * 60 * 1000;

export const decideAiReservation = ({ prev, limits, images, devices, deviceId, now }) => {
  if (Number.isFinite(limits.maxPhotosPerUpload) && images > limits.maxPhotosPerUpload) {
    return {
      ok: false,
      code: 'UPLOAD_PHOTO_LIMIT',
      message: `You can send up to ${limits.maxPhotosPerUpload} photos in one request.`,
    };
  }
  if (Number.isFinite(limits.dailyAiRequests) && prev.dayRequests + 1 > limits.dailyAiRequests) {
    return {
      ok: false,
      code: 'FAIR_USE_DAILY',
      message: `You have used today's ${limits.dailyAiRequests} AI requests on the Free plan. The allowance resets at midnight IST. Your chats and uploads are saved.`,
    };
  }
  if (prev.requests + 1 > limits.monthlyAiRequests) {
    return {
      ok: false,
      code: 'FAIR_USE_REQUESTS',
      message: 'You have reached this month\'s fair-use limit for AI requests. It resets on the 1st. Your chats and uploads are saved.',
    };
  }
  if (images > 0 && prev.images + images > limits.monthlyImages) {
    return {
      ok: false,
      code: 'FAIR_USE_IMAGES',
      message: 'You have reached this month\'s fair-use limit for photo analysis. It resets on the 1st. Your chats and uploads are saved.',
    };
  }

  const list = Array.isArray(devices) ? devices.slice(0, 50) : [];
  const fresh = list.filter(
    (d) => d && d.id && (now - Number(d.lastSeen || 0)) < DEVICE_STALE_MS
  );
  const mine = fresh.find((d) => d.id === deviceId);
  let nextDevices = fresh;
  if (mine) {
    mine.lastSeen = now;
    nextDevices = fresh;
  } else if (fresh.length >= limits.maxDevices) {
    return {
      ok: false,
      code: 'DEVICE_LIMIT',
      message: `This account is already in use on ${limits.maxDevices} devices. Sign out on another device, or wait ${DEVICE_STALE_DAYS} days for an unused one to free up.`,
    };
  } else {
    nextDevices = [...fresh, { id: deviceId, lastSeen: now }];
  }

  return {
    ok: true,
    next: {
      ...prev,
      requests: prev.requests + 1,
      images: prev.images + images,
      dayRequests: prev.dayRequests + 1,
    },
    devices: nextDevices,
  };
};

/**
 * Apply reservations serially, matching Firestore transaction isolation.
 * Parallel callers that share this mutex cannot both pass a remaining quota of 1.
 */
export const applyReservationsSerial = async (initial, attempts, decide) => {
  let state = initial;
  const results = [];
  const queue = Promise.resolve();
  let tail = queue;
  await Promise.all(
    attempts.map((attempt) => {
      const run = tail.then(async () => {
        const decision = decide(state, attempt);
        if (decision.ok) state = decision.state;
        results.push(decision);
        return decision;
      });
      tail = run.catch(() => {});
      return run;
    })
  );
  return { state, results };
};
