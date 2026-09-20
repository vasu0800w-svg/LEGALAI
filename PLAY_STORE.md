# casemate — Play Store & Hosting Guide

Package ID: `com.casemate.legalai`  
App name: **casemate**  
Version: `1.0.0` (versionCode `1`)

---

## Prerequisites

- Node.js 20+
- **[Android Studio](https://developer.android.com/studio)** installed under `/Applications/Android Studio.app`
  - Or set `export CAPACITOR_ANDROID_STUDIO_PATH="/path/to/Android Studio.app"`
- JDK 17+ (bundled with Android Studio is fine)
- A [Google Play Developer](https://play.google.com/console) account ($25 one-time)
- Firebase CLI login for hosting: `npx firebase-tools login`

### If `npm run open:android` fails

```
[error] Unable to launch Android Studio. Is it installed?
```

Android Studio is missing. Install it from https://developer.android.com/studio  
then open it once to finish SDK setup, and run `npm run open:android` again.

You can still open the project manually:

```bash
open frontend/android
# or in Android Studio: File → Open → select frontend/android
```

---

## 1. Build the web app + sync Android

From the repo root:

```bash
npm install
npm run build:android
```

Or from `frontend/`:

```bash
npm run build:android
```

This runs `vite build` and `npx cap sync android`.

Open the native project:

```bash
npm run open:android
```

---

## 2. Create the upload keystore (once)

```bash
cd frontend/android
keytool -genkey -v -keystore casemate-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias casemate
```

Copy the example properties file and fill in real passwords:

```bash
cp keystore.properties.example keystore.properties
```

Edit `frontend/android/keystore.properties`:

```
storeFile=../casemate-upload.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=casemate
keyPassword=YOUR_KEY_PASSWORD
```

**Never commit** `*.jks`, `*.keystore`, or `keystore.properties` (already gitignored).

Back up the `.jks` file and passwords offline — losing them blocks app updates.

---

## 3. Generate a signed App Bundle (AAB)

### Option A — Android Studio (easiest)

1. `npm run open:android`
2. **Build → Generate Signed Bundle / APK**
3. Choose **Android App Bundle**
4. Select `casemate-upload.jks`, alias `casemate`
5. Build **release**
6. Output: `frontend/android/app/release/app-release.aab`

### Option B — Command line

```bash
cd frontend/android
./gradlew bundleRelease
```

AAB path: `app/build/outputs/bundle/release/app-release.aab`

---

## 4. Deploy Firebase Hosting (privacy policy URL)

Hosting project: **legalai-78759**

Run from the **repo root** (`LEGALAI/`), not from `frontend/android`:

```bash
cd /Users/vedantthakur/LEGALAI
npx firebase-tools login
npm run deploy:hosting
```

Or from `frontend/`:

```bash
cd /Users/vedantthakur/LEGALAI/frontend
npm run deploy:hosting
```

Public URLs after deploy:

- App: `https://legalai-78759.web.app/`
- Privacy policy: `https://legalai-78759.web.app/privacy`

Use the privacy URL in Play Console → App content → Privacy policy.

---

## 5. Play Console checklist

1. **Create app** → package name must be `com.casemate.legalai`
2. **Store listing**
   - Title: casemate Assistant (≤30 chars)
   - Short description (≤80 chars)
   - Full description
   - App icon 512×512 (`frontend/public/icons/icon-512.png`)
   - Feature graphic 1024×500
   - Phone screenshots (at least 2)
3. **Privacy policy** → `https://legalai-78759.web.app/privacy`
4. **App content**
   - Privacy policy
   - Data safety (declare: Firebase Auth, Firestore, Gemini AI processing, Razorpay payments, EmailJS if used)
   - Content rating questionnaire
5. **Audience** — not primarily children
6. **Pricing** — Free (or set paid)
7. **Countries** — select distribution
8. **Testing** — upload AAB to **Internal testing** first, invite testers, verify login/chat/PDF/DOCX
9. **Production** — promote when stable

### Data safety hints

| Data | Collected | Shared | Purpose |
|------|-----------|--------|---------|
| Email / name | Yes | With Firebase | Account |
| User content (chats, uploads) | Yes | With Google AI (Gemini) for generation | App functionality |
| Payment info | Via Razorpay | Razorpay | Subscriptions |

---

## 6. Day-to-day update flow

```bash
# after code changes
npm run build:android
npm run open:android
# bump versionCode / versionName in frontend/android/app/build.gradle
# Build → Generate Signed Bundle → upload new AAB
```

For web-only updates (Hosting):

```bash
npm run deploy:hosting
```

Note: the Play Store app ships **bundled** web assets. Hosting updates do **not** automatically update installed Play apps — ship a new AAB for native users.

---

## 7. Smoke test on device/emulator

- [ ] App launches (splash → auth)
- [ ] Email signup / login / verification
- [ ] Chat send + generate document
- [ ] Upload case + format files
- [ ] Download PDF / DOCX (Share sheet on Android)
- [ ] Subscription / Razorpay flow (test keys)
- [ ] Logout

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank WebView | Re-run `npm run build:android` |
| PDF/DOCX won’t save | Use Share sheet; ensure Filesystem/Share plugins synced |
| Signing failed | Check `keystore.properties` paths relative to `android/` |
| Hosting 404 on refresh | `firebase.json` already rewrites SPA to `index.html` |
| Tailwind missing styles | Confirm `index.css` imported and Tailwind build ran |
