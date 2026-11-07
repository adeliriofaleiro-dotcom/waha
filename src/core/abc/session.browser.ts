import * as fs from 'fs';

//
// Browser executable path detection
//

// Ordered: Chrome paths first, then Chromium.
// Windows: only global Program Files paths (no per-user %LOCALAPPDATA%).
const BROWSER_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};

export function getBrowserExecutablePath(): string {
  const paths = BROWSER_PATHS[process.platform] ?? BROWSER_PATHS['linux'];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return paths[0];
}

// Linux containers need these to start Chrome as root. On macOS they turn off
// the seatbelt sandbox and can abort Chrome during process startup. They are
// omitted there. Callers must not add them back.
const SANDBOX_DISABLE_ARGS = [
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--no-zygote',
];

export function browserLaunchArgs(platform: NodeJS.Platform): string[] {
  const args = [
    '--disable-accelerated-2d-canvas',
    '--disable-application-cache',
    // Do not disable the software rasterizer; video breaks without it.
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-metrics',
    '--disable-gpu',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-offline-load-stale-cache',
    '--disable-popup-blocking',
    '--disable-setuid-sandbox',
    '--disable-site-isolation-trials',
    '--disable-speech-api',
    '--disable-sync',
    '--disable-translate',
    '--disable-web-security',
    '--hide-scrollbars',
    '--ignore-certificate-errors',
    '--ignore-ssl-errors',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-pings',
    '--no-sandbox',
    '--no-zygote',
    '--password-store=basic',
    '--renderer-process-limit=2',
    '--safebrowsing-disable-auto-update',
    '--use-mock-keychain',
    '--window-size=1280,720',
    '--disable-blink-features=AutomationControlled',
    '--disk-cache-size=1073741824',
  ];
  if (platform !== 'darwin') {
    return args;
  }
  return args.filter(function keepArg(arg: string) {
    return !SANDBOX_DISABLE_ARGS.includes(arg);
  });
}

// A path belongs to Google Chrome when it contains "google" in any casing.
// All Chrome paths include "Google" (macOS/Windows) or "google-chrome" (Linux),
// while Chromium paths never do.
export function isChromeExecutablePath(executablePath: string): boolean {
  return executablePath.toLowerCase().includes('google');
}
