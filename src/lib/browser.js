import { chromium } from 'playwright';
import { config } from '../config.js';

/**
 * Společné volby pro Pi 5 / headless Linux (malé /dev/shm v kontejnerech;
 * na běžném Pi 5 obvykle netřeba, ale neškodí).
 */
function launchOptions() {
  return {
    headless: config.playwrightHeadless,
    slowMo: config.playwrightSlowMo > 0 ? config.playwrightSlowMo : undefined,
    args: ['--disable-dev-shm-usage'],
  };
}

/**
 * @param {(browser: import('playwright').Browser) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withBrowser(fn) {
  const browser = await chromium.launch(launchOptions());
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}
