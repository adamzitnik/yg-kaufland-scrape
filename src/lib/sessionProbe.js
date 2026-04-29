import { config, cockpitDashboardUrlForStorefront } from '../config.js';
import { dismissOnetrustIfPresent } from './onetrust.js';
import { humanPause, sleep } from './humanize.js';

const PROBE_MS = 22_000;

/**
 * Zjistí, co aktuální stránka po načtení dashboardu „chce“.
 * @param {string} [firstStorefront] — první storefront pro URL (výchozí z configu)
 * @returns {Promise<{ status: 'logged_in' | 'need_password' | 'need_otp' | 'unknown', url: string }>}
 */
export async function probeSellerSession(page, firstStorefront) {
  const sf = (firstStorefront ?? config.cockpitStorefronts[0]).trim();
  await humanPause(200, 550);
  await page.goto(
    cockpitDashboardUrlForStorefront(sf),
    {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    },
  );
  await humanPause(280, 800);
  await dismissOnetrustIfPresent(page);

  const kpiValue = page.locator('.cockpit__kpi [class*="__kpi-value"]').first();
  const userField = page.locator('input[name="username"]');
  const otpField = page.getByPlaceholder(/security code|sicherheitscode/i);

  const race = await Promise.race([
    kpiValue
      .waitFor({ state: 'visible', timeout: PROBE_MS })
      .then(() => 'logged_in'),
    userField
      .waitFor({ state: 'visible', timeout: PROBE_MS })
      .then(() => 'need_password'),
    otpField
      .waitFor({ state: 'visible', timeout: PROBE_MS })
      .then(() => 'need_otp'),
    sleep(PROBE_MS + 500).then(() => 'timeout'),
  ]).catch(() => 'timeout');

  const url = page.url();

  if (race === 'logged_in') {
    return { status: 'logged_in', url };
  }
  if (race === 'need_password') {
    return { status: 'need_password', url };
  }
  if (race === 'need_otp') {
    return { status: 'need_otp', url };
  }

  if (/login|account\.kaufland/i.test(url)) {
    return { status: 'need_password', url };
  }

  const cockpit = page.locator('.cockpit__kpi');
  if (await cockpit.isVisible().catch(() => false)) {
    return { status: 'logged_in', url };
  }

  return { status: 'unknown', url };
}
