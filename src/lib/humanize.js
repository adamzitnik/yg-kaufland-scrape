/**
 * Lehká „humanizace“: náhodné viewporty, UA, pauzy, pomalé psaní.
 * Nejde o plný anti-detect — jen rozumné mantinely proti okamžitému bot fingerprintu.
 */

import fs from 'node:fs';

/** @returns {number} */
export function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Náhodná pauza mezi kroky (ms). */
export async function humanPause(min = 200, max = 800) {
  await sleep(randomInt(min, max));
}

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
];

export function randomViewport() {
  return VIEWPORTS[randomInt(0, VIEWPORTS.length - 1)];
}

/** Poslední stabilní Chrome UA (Windows / macOS). */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

export function randomUserAgent() {
  return USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];
}

/**
 * @param {import('playwright').Locator} locator
 * @param {string} text
 */
export async function humanType(locator, text) {
  const delay = randomInt(48, 165);
  await locator.pressSequentially(text, { delay });
}

/** Lehce posune kurzor (není to anti-bot magie, jen mírně méně „robot“). */
export async function jitterMouse(page) {
  const vp = page.viewportSize();
  if (!vp || vp.width < 120 || vp.height < 120) {
    return;
  }
  const x = randomInt(50, vp.width - 50);
  const y = randomInt(50, vp.height - 50);
  await page.mouse.move(x, y, { steps: randomInt(4, 14) });
}

/**
 * Kontext s náhodným viewportem a UA.
 * @param {import('playwright').Browser} browser
 * @param {(page: import('playwright').Page, context: import('playwright').BrowserContext) => Promise<T>} fn
 * @param {{ storageStateFile?: string }} [options] — pokud soubor existuje, načte cookies + storage (Playwright storageState)
 * @returns {Promise<T>}
 */
export async function withHumanizedContext(browser, fn, options = {}) {
  const ctxOpts = {
    viewport: randomViewport(),
    userAgent: randomUserAgent(),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    hasTouch: false,
    isMobile: false,
    colorScheme: 'light',
  };

  const stateFile = options.storageStateFile;
  if (stateFile && fs.existsSync(stateFile)) {
    ctxOpts.storageState = stateFile;
  }

  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  try {
    return await fn(page, context);
  } finally {
    await context.close();
  }
}
