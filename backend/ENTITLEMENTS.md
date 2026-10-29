# Casemate entitlements (Part 4)

Single source of truth for plans, usage, and what an authenticated user may do.
The website, web app, Android app, and API all read the same catalog and the same
user document. Client UI is not enforcement.

## Data model (`users_data/{uid}` on Firestore database `legal`)

| Field | Who writes | Meaning |
| --- | --- | --- |
| `plan` | Admin SDK only | `free` \| `basic` \| `pro` \| `annual` \| `custom` |
| `customPlan` | Admin SDK | Last verified custom selection + quoted total |
| `subscriptionExpiryDate` | Admin SDK | Paid cycle end. Extend-only; never shortened. |
| `billingCycleStart` | Admin SDK | Start of the current paid window |
| `paymentStatus` | Admin SDK | `paid` / `expired` / `none` |
| `planSource`, `planOrderId` | Admin SDK | Last verified Razorpay grant |
| `addOns` | Admin SDK | `{ extraDrafts, extraMonthlyImages, extraDailyAi, extraSessionChars, extraSessionCharsMonth, extraSessionCharsUntil }` |
| `aiUsage` | Admin SDK | `{ month, requests, images, day, dayRequests, monthDrafts, updatedAt }` |
| `devices` | Admin SDK | `[{ id, lastSeen }]` random per-install ids |
| `promoKind` / `promoExpiresAt` / `promoCode` | Admin SDK | Promo grant |
| `draftCount` | Client (compat) + server on reserve | Display only. Server quota is `aiUsage.monthDrafts` |
| `chats/{chatId}` | Owner | Chat body. Character count = `message.text` only |

Catalog: `app_config/plans` `{ plans, freeLimits, paidLimits, addOns }`.
Public read; admin write. Missing fields keep shipped defaults (not a silent cut).

Orders: `orders/{razorpayOrderId}` backend-only.
Idempotency: `payments/{razorpayPaymentId}` backend-only. A payment id cannot grant twice.

Storage: `users/{uid}/**` owner-only, 20MB, type allowlist. Download URLs are tokenized;
they are not public listings.

## What counts

- **Characters:** concatenated `message.text`. Image bytes, filenames, mime types, and
  evidence notes are not characters.
- **Photos / chat:** attachments with `type === 'case'`.
- **Photos / upload:** inline images in one Gemini request / one attach batch.
- **Daily AI:** `aiUsage.dayRequests` on the IST calendar date. Resets midnight IST.
- **Monthly AI / images / drafts:** UTC `YYYY-MM` key on `aiUsage` (same as existing
  monthly AI). Resets on the 1st.
- **Draft:** one successful reservation for `X-Work-Kind: draft` (the generate-document
  call). Analysis batches, chat replies, format extraction, and failed Gemini calls
  do not keep a draft. Failures refund via `releaseDraft`. Concurrent reserves run
  in a Firestore transaction.
- **Device:** opaque 32-hex id in `localStorage.casemate_device_id`. Not a hardware
  fingerprint. Slots go stale after 14 days. Settings can list and revoke.

Paid plans still have unlimited **draft count**. Fair use for those plans is the
existing monthly AI / image cap, which is disclosed as “unlimited drafts (fair use)”.

## Backend enforcement

| Endpoint | Auth | Rule |
| --- | --- | --- |
| `GET /api/entitlements` | Firebase ID token | Snapshot of plan, limits, remaining, devices, catalog |
| `GET /api/devices` | token | List registered devices |
| `POST /api/devices/revoke` | token | Drop a device id |
| `POST /api/validate-chat-limits` | token | Ignores client `plan`/`email`. Uses the user doc; optional `chatId` ownership read |
| `POST /api/gemini` | token | Reserve AI (+ draft if `X-Work-Kind: draft`). Refund on failure |
| `GET /api/custom-plan` | public | Configurable unit prices + default selection |
| `POST /api/custom-plan/quote` | public | Server-calculated itemized total. Client totals are ignored |
| `POST /api/create-order` | token | Prices from server catalog. `planId`, `addOnId`, or `kind: custom` + selection |
| `POST /api/verify-payment` | token + Razorpay signature | Transactional grant. Duplicate `paymentId` refused. Higher active plan is kept |

Firestore rules block client changes to plan, expiry, `aiUsage`, devices, promo,
add-ons, billing dates, and payment status.

## Migration

- Additive fields only. Existing `plan` / `subscriptionExpiryDate` are not rewritten.
- First draft reserve seeds `monthDrafts` from client `draftCount` when
  `lastResetDate` is the current JS month, so a free user who already used drafts
  this month is not given a fresh five.
- Buying a cheaper plan while a higher plan is still in date keeps the higher plan
  and still extends expiry (never a silent downgrade).
- Unlimited email list is unchanged.

## Tests

`cd backend && npm test` — character vs image bytes, photo counts, extend-not-shorten,
plan-rank preservation, draft seeding, add-on stacking, remaining counters, device
payload shape.

## Part 5 catalog (new purchases)

| Plan | List price | Drafts | Photos / upload | Chars / chat | Devices |
| --- | --- | --- | --- | --- | --- |
| Free | ₹0 | 5 / month | 20 | 20,000 | 2 |
| Casemate Basic | ₹2,999 / month | 50 / month | 80 | 60,000 | 3 |
| Casemate Pro | ₹4,999 / month | Unlimited (monthly AI fair use) | 200 | 1,20,000 | 5 |
| Annual | ₹34,990 / year | Same as Pro | 200 | 1,20,000 | 5 |

Annual saving vs 12× Pro: ₹59,988 − ₹34,990 = ₹24,998 (41.7% before tax).
Live `app_config/plans` prices still override these defaults until an admin save.
Existing paid users without `entitlementsVersion` 5 keep pre-Part-5 limits.

## Part 6 custom plan

Configurable unit prices live in `app_config/plans.customPlanPricing` (merged onto code defaults).

| Line | Interpretation | Default |
| --- | --- | --- |
| Photos / upload | **Total** per upload, blocks of 10. Included: 0 | ₹350 / 10 |
| Photos / chat | Optional **flat** feature, not per photo. Cap ≥ upload | ₹50 |
| Characters / chat | **Total**. Charge extra 5,000 blocks above 20,000 included | ₹249 / 5,000 |
| Drafts / month | **Total** completed drafts. Counted only after a successful generate | ₹29 / 5 |
| Devices | **Total**. First included | ₹199 each extra |

Quote and checkout use the same `quoteCustomPlan` function. The client cannot submit a total. The Razorpay order stores the locked selection and limits; verify does not re-price.

Custom grants `plan: custom` for 30 prepaid days (rank 1). An active Pro/Annual grant is kept. Daily AI stays at the Free allowance (20/day, 120/month) because unlimited AI is not sold on this builder.

## Part 7 Increase Chat Limit

Prepaid Razorpay add-ons `chat_chars_20k` (₹199 / +20,000) and `chat_chars_50k` (₹399 / +50,000). Prices live in `app_config/plans.addOns`.

- Scope: **every chat** on the account for the **remainder of the current UTC calendar month**.
- Not a permanent raise. Next month the extra drops off; conversation history is kept.
- Not sold when `maxSessionChars` is already unlimited (no benefit).
- Duplicate Razorpay `paymentId` still cannot grant twice.
- Razorpay here is prepaid, not auto-renew. There is no in-app cancel of a recurring cycle because none is created. Access lasts until the paid-through date already stored. Refunds follow the published policy.

## Remaining integration (not Part 4)

- Deploy Firestore rules + Render API before the new endpoints work in production.
- Chat-limit add-on UI ships in Part 7; extra drafts/photos catalog SKUs still have no dedicated storefront.
- AAB rebuild when the installed app should show device management.
- Live Firebase rules emulator / concurrent two-request draft race against a real
  project (unit tests cover the math; the transaction is the race control).
