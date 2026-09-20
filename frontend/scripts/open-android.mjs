#!/usr/bin/env node
/**
 * Opens the Capacitor Android project in Android Studio when installed.
 * Falls back to Finder + clear install instructions if missing.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const androidDir = path.resolve(__dirname, '../android');

const candidates = [
  process.env.CAPACITOR_ANDROID_STUDIO_PATH,
  '/Applications/Android Studio.app',
  '/Applications/Android Studio Preview.app',
  `${process.env.HOME}/Applications/Android Studio.app`,
  `${process.env.HOME}/Applications/Android Studio Preview.app`,
].filter(Boolean);

const studioApp = candidates.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!fs.existsSync(androidDir)) {
  console.error('[error] Android project not found at frontend/android');
  console.error('Run: npm run build:android');
  process.exit(1);
}

if (studioApp) {
  console.log(`Opening Android Studio: ${studioApp}`);
  console.log(`Project: ${androidDir}`);
  const child = spawn('open', ['-a', studioApp, androidDir], {
    stdio: 'inherit',
    detached: true,
  });
  child.unref();
  process.exit(0);
}

console.error('');
console.error('Android Studio is not installed (or not in the default location).');
console.error('');
console.error('Capacitor looked for:');
candidates.forEach((p) => console.error(`  - ${p}`));
console.error('');
console.error('Fix:');
console.error('  1. Install Android Studio: https://developer.android.com/studio');
console.error('  2. Open it once, finish the setup wizard (SDK + Platform Tools)');
console.error('  3. Re-run: npm run open:android');
console.error('');
console.error('If Android Studio is installed elsewhere:');
console.error('  export CAPACITOR_ANDROID_STUDIO_PATH="/full/path/to/Android Studio.app"');
console.error('  npm run open:android');
console.error('');
console.error('Opening the android/ folder in Finder for now...');
spawn('open', [androidDir], { stdio: 'inherit', detached: true }).unref();
process.exit(1);
