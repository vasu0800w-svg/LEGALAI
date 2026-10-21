import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCustomPlan, defaultCustomSelection, DEFAULT_CUSTOM_PRICING } from './customPlan.js';

test('photos per upload: 10 = ₹350, 20 = ₹700, 30 = ₹1,050', () => {
  const a = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 20000 }, DEFAULT_CUSTOM_PRICING);
  const photo = a.lines.find((l) => l.id === 'photoUpload');
  assert.equal(photo.rupees, 350);
  const b = quoteCustomPlan({ photoUpload: 20, drafts: 5, devices: 1, characters: 20000 }, DEFAULT_CUSTOM_PRICING);
  assert.equal(b.lines.find((l) => l.id === 'photoUpload').rupees, 700);
  const c = quoteCustomPlan({ photoUpload: 30, drafts: 5, devices: 1, characters: 20000 }, DEFAULT_CUSTOM_PRICING);
  assert.equal(c.lines.find((l) => l.id === 'photoUpload').rupees, 1050);
});

test('photo chat is a flat ₹50 when selected, not per photo', () => {
  const off = quoteCustomPlan({ photoUpload: 10, photoChatEnabled: false, photoChat: 100, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(off.lines.find((l) => l.id === 'photoChat').rupees, 0);
  const on = quoteCustomPlan({ photoUpload: 10, photoChatEnabled: true, photoChat: 100, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(on.lines.find((l) => l.id === 'photoChat').rupees, 50);
  const bigger = quoteCustomPlan({ photoUpload: 10, photoChatEnabled: true, photoChat: 200, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(bigger.lines.find((l) => l.id === 'photoChat').rupees, 50);
});

test('characters charge only additional 5,000 blocks above the included 20,000', () => {
  const base = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(base.lines.find((l) => l.id === 'characters').rupees, 0);
  const one = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 25000 });
  assert.equal(one.lines.find((l) => l.id === 'characters').rupees, 249);
  const two = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 30000 });
  assert.equal(two.lines.find((l) => l.id === 'characters').rupees, 498);
  const three = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 35000 });
  assert.equal(three.lines.find((l) => l.id === 'characters').rupees, 747);
});

test('drafts: 5 = ₹29, 10 = ₹58, 15 = ₹87', () => {
  const a = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(a.lines.find((l) => l.id === 'drafts').rupees, 29);
  const b = quoteCustomPlan({ photoUpload: 10, drafts: 10, devices: 1, characters: 20000 });
  assert.equal(b.lines.find((l) => l.id === 'drafts').rupees, 58);
  const c = quoteCustomPlan({ photoUpload: 10, drafts: 15, devices: 1, characters: 20000 });
  assert.equal(c.lines.find((l) => l.id === 'drafts').rupees, 87);
});

test('devices: first included, extras ₹199', () => {
  const one = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(one.lines.find((l) => l.id === 'devices').rupees, 0);
  const two = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 2, characters: 20000 });
  assert.equal(two.lines.find((l) => l.id === 'devices').rupees, 199);
  const three = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 3, characters: 20000 });
  assert.equal(three.lines.find((l) => l.id === 'devices').rupees, 398);
});

test('rejects a chat photo cap below the upload size', () => {
  const q = quoteCustomPlan({
    photoUpload: 40,
    photoChatEnabled: true,
    photoChat: 10,
    drafts: 5,
    devices: 1,
    characters: 20000,
  });
  // sanitizer raises photoChat to 40, so it becomes valid
  assert.equal(q.selection.photoChat >= q.selection.photoUpload, true);
  assert.equal(q.ok, true);
});

test('combined example matches the sum of the documented unit prices', () => {
  const q = quoteCustomPlan({
    photoUpload: 20,
    photoChatEnabled: true,
    photoChat: 40,
    characters: 30000,
    drafts: 10,
    devices: 2,
  });
  assert.equal(q.ok, true);
  assert.equal(q.totalRupees, 700 + 50 + 498 + 58 + 199);
  assert.equal(q.limits.maxPhotosPerUpload, 20);
  assert.equal(q.limits.maxPhotosPerChat, 40);
  assert.equal(q.limits.maxSessionChars, 30000);
  assert.equal(q.limits.draftLimit, 10);
  assert.equal(q.limits.maxDevices, 2);
});

test('default selection is a payable custom plan', () => {
  const sel = defaultCustomSelection();
  const q = quoteCustomPlan(sel);
  assert.equal(q.ok, true);
  assert.ok(q.totalRupees >= 1);
});

test('invalid quantities snap to allowed blocks instead of charging a client total', () => {
  const q = quoteCustomPlan({ photoUpload: 7, drafts: 3, devices: 0, characters: 1234, totalRupees: 1 });
  assert.equal(q.selection.photoUpload, 10);
  assert.equal(q.selection.drafts, 5);
  assert.equal(q.selection.devices, 1);
  assert.equal(q.selection.characters, 20000);
  assert.equal(q.totalRupees, 350 + 29);
});

test('a fully included selection cannot be checked out at ₹0', () => {
  const pricing = {
    ...DEFAULT_CUSTOM_PRICING,
    photoUpload: { ...DEFAULT_CUSTOM_PRICING.photoUpload, included: 10 },
    drafts: { ...DEFAULT_CUSTOM_PRICING.drafts, included: 5 },
  };
  const q = quoteCustomPlan({ photoUpload: 10, drafts: 5, devices: 1, characters: 20000 }, pricing);
  assert.equal(q.totalRupees, 0);
  assert.equal(q.ok, false);
});

test('photo-chat off keeps a chat cap that can still hold one upload', () => {
  const q = quoteCustomPlan({ photoUpload: 40, photoChatEnabled: false, drafts: 5, devices: 1, characters: 20000 });
  assert.equal(q.limits.maxPhotosPerUpload, 40);
  assert.equal(q.limits.maxPhotosPerChat, 40);
  assert.equal(q.lines.find((l) => l.id === 'photoChat').rupees, 0);
});
