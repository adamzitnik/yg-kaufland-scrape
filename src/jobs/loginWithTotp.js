import { authenticator } from 'otplib';
import { withBrowser } from '../lib/browser.js';
import {
  withHumanizedContext,
  humanPause,
  humanType,
  randomInt,
} from '../lib/humanize.js';
import { loginThroughOtpPrompt } from './sellerLoginCore.js';
import {
  loadAllStorefrontKpis,
  printAllStorefrontKpis,
} from './dashboardKpi.js';
import { probeSellerSession } from '../lib/sessionProbe.js';
import {
  storageFileExists,
  saveStorageState,
  removeStorageStateFile,
} from '../lib/sessionStorage.js';
import { fetchScrapeSettings, postScrapeResult } from '../lib/scrapeRemote.js';
import { logRun, logError } from '../lib/logger.js';
import { config } from '../config.js';

const POST_AUTH_MS = 90_000;

function normalizeTotpSecret(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, '');
}

async function attachIngestStatus(result) {
  try {
    const ingest = await postScrapeResult(result);
    return { ...result, ingest };
  } catch (e) {
    logError('postScrapeResult', e);
    return {
      ...result,
      ingest: { ok: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {string} secret
 * @param {{ loginEmail: string, storefrontCodes: string[] | null }} runOpts
 */
async function runFullLoginAndDashboard(page, context, secret, runOpts) {
  await loginThroughOtpPrompt(page, { email: runOpts.loginEmail });

  const otpInput = page.getByPlaceholder(/security code|sicherheitscode/i);
  await otpInput.waitFor({ state: 'visible', timeout: 20_000 });

  const token = authenticator.generate(secret);

  await humanPause(320, 900);
  await otpInput.click({ delay: randomInt(12, 55) });
  await humanPause(100, 280);
  await humanType(otpInput, token);

  await humanPause(200, 620);
  const authBtn = page.getByRole('button', {
    name: 'Authenticate',
    exact: true,
  });
  await authBtn.hover().catch(() => {});
  await humanPause(80, 260);
  await authBtn.click();

  try {
    await Promise.race([
      page.locator('.verify').waitFor({ state: 'hidden', timeout: POST_AUTH_MS }),
      page
        .locator('h1.verify__title')
        .waitFor({ state: 'hidden', timeout: POST_AUTH_MS }),
    ]);
  } catch {
    const url = page.url();
    const title = await page.title();
    const stillVerify = await otpInput.isVisible().catch(() => false);
    return {
      job: 'loginWithTotp',
      ok: false,
      loggedIn: false,
      loginSkipped: false,
      sessionStatus: 'full_login_failed',
      url,
      title,
      hint: stillVerify
        ? 'Stále obrazovka 2FA — špatný TOTP, zpoždění času, nebo změna UI.'
        : 'Timeout po Authenticate — zkontroluj přesměrování.',
    };
  }

  await humanPause(400, 1100);

  const dashboard = await loadAllStorefrontKpis(
    page,
    runOpts.storefrontCodes,
  );
  printAllStorefrontKpis(dashboard);

  await saveStorageState(context, config.storageStatePath);

  return {
    job: 'loginWithTotp',
    ok: true,
    loggedIn: true,
    loginSkipped: false,
    sessionStatus: 'full_login',
    url: page.url(),
    title: await page.title(),
    dashboard: {
      ok: dashboard.ok,
      storefronts: dashboard.storefronts,
    },
  };
}

/**
 * Login + OTP + dashboard KPI. Volitelně GET Laravel `…/kaufland/scrape-settings` (hash v hlavičce).
 */
export async function runLoginWithTotp() {
  let remote = null;
  try {
    remote = await fetchScrapeSettings();
  } catch (e) {
    logError('fetchScrapeSettings', e);
    throw e;
  }

  if (remote && !remote.enabled) {
    logRun('KPI scrape vypnutý (kaufland_kpi_scrape_enabled).');
    const disabled = {
      job: 'loginWithTotp',
      ok: true,
      skipped: true,
      reason: 'disabled_by_laravel',
      scrapeSettings: { enabled: false },
    };
    return attachIngestStatus(disabled);
  }

  const storefrontCodes = remote?.storefronts?.length
    ? remote.storefronts
    : null;
  const loginEmail = (
    remote?.email?.trim() ||
    config.kauflandSellerEmail.trim()
  ).trim();

  if (!loginEmail) {
    throw new Error(
      'Chybí e-mail: nastav Laravel `kaufland_kpi_scrape_email_login` nebo KAUFLAND_SELLER_EMAIL v .env',
    );
  }
  if (!config.kauflandSellerPassword) {
    throw new Error('Chybí KAUFLAND_SELLER_PASSWORD v .env');
  }
  const secret = normalizeTotpSecret(config.totpSecret);
  if (!secret) {
    throw new Error('Chybí TOTP_SECRET v .env');
  }

  const firstSf = storefrontCodes?.length
    ? storefrontCodes[0]
    : config.cockpitStorefronts[0];

  const runOpts = { loginEmail, storefrontCodes };
  const storagePath = config.storageStatePath;

  return withBrowser(async (browser) => {
    if (storageFileExists(storagePath)) {
      try {
        const restored = await withHumanizedContext(
          browser,
          async (page, context) => {
            const probe = await probeSellerSession(page, firstSf);

            if (probe.status !== 'logged_in') {
              removeStorageStateFile(storagePath);
              return { useFullLogin: true, probe };
            }

            const dashboard = await loadAllStorefrontKpis(
              page,
              storefrontCodes,
            );
            printAllStorefrontKpis(dashboard);

            await saveStorageState(context, storagePath);

            return {
              useFullLogin: false,
              probe,
              result: {
                job: 'loginWithTotp',
                ok: true,
                loggedIn: true,
                loginSkipped: true,
                sessionStatus: probe.status,
                url: page.url(),
                title: await page.title(),
                dashboard: {
                  ok: dashboard.ok,
                  storefronts: dashboard.storefronts,
                },
                ...(remote ? { scrapeSettings: remote } : {}),
              },
            };
          },
          { storageStateFile: storagePath },
        );

        if (!restored.useFullLogin) {
          return attachIngestStatus(restored.result);
        }
        if (restored.probe) {
          console.log(
            '[session] Uložená relace nestačí:',
            restored.probe.status,
            restored.probe.url,
          );
        }
      } catch (e) {
        removeStorageStateFile(storagePath);
        logError('session restore', e);
        console.log(
          '[session] Poškozený nebo nečitelný storage soubor — mažu a jdu na plný login.',
        );
      }
    }

    const full = await withHumanizedContext(
      browser,
      async (page, context) =>
        runFullLoginAndDashboard(page, context, secret, runOpts),
    );
    if (remote && full && typeof full === 'object' && !('scrapeSettings' in full)) {
      return attachIngestStatus({ ...full, scrapeSettings: remote });
    }
    return attachIngestStatus(full);
  });
}
