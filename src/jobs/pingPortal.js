import { withBrowser } from '../lib/browser.js';
import { config } from '../config.js';

/**
 * Smoke test: načte portál v reálném prohlížeči (JS proběhne).
 * Později: login, OTP, parsování čísel.
 */
export async function runPingPortal() {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(config.portalEntryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const title = await page.title();
    const url = page.url();
    return {
      job: 'pingPortal',
      ok: true,
      title,
      url,
    };
  });
}
