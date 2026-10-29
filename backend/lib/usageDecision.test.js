import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReservationsSerial, decideAiReservation } from './usageDecision.js';

const limits = {
  maxPhotosPerUpload: 3,
  dailyAiRequests: 5,
  monthlyAiRequests: 8,
  monthlyImages: 10,
  maxDevices: 2,
};

const prev = () => ({ month: '2026-10', requests: 0, images: 0, day: '2026-10-29', dayRequests: 0 });

test('eight concurrent AI reservations against a daily cap of 5 admit exactly five', async () => {
  const { results } = await applyReservationsSerial(
    { prev: prev(), devices: [] },
    Array.from({ length: 8 }, () => ({ images: 0, deviceId: 'device-a', now: 1 })),
    (state, attempt) => {
      const decision = decideAiReservation({
        prev: state.prev,
        limits,
        images: attempt.images,
        devices: state.devices,
        deviceId: attempt.deviceId,
        now: attempt.now,
      });
      if (!decision.ok) return decision;
      return { ok: true, state: { prev: decision.next, devices: decision.devices } };
    }
  );
  const admitted = results.filter((r) => r.ok).length;
  const rejected = results.filter((r) => r.code === 'FAIR_USE_DAILY').length;
  assert.equal(admitted, 5);
  assert.equal(rejected, 3);
});

test('a remaining quota of one cannot be consumed twice when reservations are serial', async () => {
  const start = { prev: { ...prev(), dayRequests: 4, requests: 4 }, devices: [] };
  const { results } = await applyReservationsSerial(
    start,
    [
      { images: 0, deviceId: 'device-a', now: 1 },
      { images: 0, deviceId: 'device-a', now: 1 },
    ],
    (state, attempt) => {
      const decision = decideAiReservation({
        prev: state.prev,
        limits,
        images: attempt.images,
        devices: state.devices,
        deviceId: attempt.deviceId,
        now: attempt.now,
      });
      if (!decision.ok) return decision;
      return { ok: true, state: { prev: decision.next, devices: decision.devices } };
    }
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.code === 'FAIR_USE_DAILY').length, 1);
});
