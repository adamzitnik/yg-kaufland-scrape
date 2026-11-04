import { config } from '../config.js';
import { withBrowser } from '../lib/browser.js';
import {
  withHumanizedContext,
  humanPause,
  humanType,
  randomInt,
} from '../lib/humanize.js';
import {
  storageFileExists,
  saveStorageState,
  removeStorageStateFile,
} from '../lib/sessionStorage.js';
import { postWarehouseScrapeResult } from '../lib/scrapeRemote.js';
import { logRun, logError } from '../lib/logger.js';

const NAV_MS = 60_000;
const SUMMARY_WAIT_MS = 45_000;

/** @type {ReadonlyArray<{ cell: string, sub?: string, section: string, label: string, key: string }>} */
const KPI_CELLS = [
  {
    cell: 'toPickOrders',
    sub: 'toPickSub',
    section: 'Warehouse',
    label: 'K vychystání (objednávky)',
    key: 'toPickOrders',
  },
  {
    cell: 'toDispatchOrders',
    sub: 'toDispatchSub',
    section: 'Warehouse',
    label: 'K expedici (objednávky)',
    key: 'toDispatchOrders',
  },
  {
    cell: 'receivedTodayPieces',
    sub: 'receivedTodaySub',
    section: 'Warehouse',
    label: 'Dnes přijato (ks)',
    key: 'receivedTodayPieces',
  },
  {
    cell: 'shippedTodayPieces',
    sub: 'shippedTodaySub',
    section: 'Warehouse',
    label: 'Dnes expedováno (ks)',
    key: 'shippedTodayPieces',
  },
  {
    cell: 'stockPieces',
    sub: 'stockPiecesSub',
    section: 'Warehouse',
    label: 'Fyzicky skladem (ks)',
    key: 'stockPieces',
  },
  {
    cell: 'stockValue',
    sub: 'stockValueSub',
    section: 'Warehouse',
    label: 'Hodnota zásob (bez DPH)',
    key: 'stockValue',
  },
];

async function attachWarehouseIngest(result) {
  try {
    const ingest = await postWarehouseScrapeResult(result);
    return { ...result, ingest };
  } catch (e) {
    logError('postWarehouseScrapeResult', e);
    return {
      ...result,
      ingest: { ok: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * @param {import('playwright').Page} page
 */
function isLoginUrl(page) {
  return /\/Identity\/Account\/Login/i.test(page.url());
}

/**
 * @param {import('playwright').Page} page
 */
async function loginIfNeeded(page) {
  if (!isLoginUrl(page)) {
    return { loggedIn: true, loginSkipped: true };
  }

  const email = config.crmEmail.trim();
  const password = config.crmPassword;
  if (!email || !password) {
    throw new Error(
      'CRM login vyžaduje CRM_EMAIL a CRM_PASSWORD v .env (nebo YG_CRM_*)',
    );
  }

  const emailInput = page.locator('#Input_Email');
  const passwordInput = page.locator('#Input_Password');
  await emailInput.waitFor({ state: 'visible', timeout: 20_000 });

  await humanPause(200, 500);
  await emailInput.click({ delay: randomInt(10, 40) });
  await humanType(emailInput, email);
  await humanPause(150, 400);
  await passwordInput.click({ delay: randomInt(10, 40) });
  await humanType(passwordInput, password);

  const remember = page.locator('#Input_RememberMe');
  if (await remember.isVisible().catch(() => false)) {
    const checked = await remember.isChecked().catch(() => false);
    if (!checked) {
      await remember.check({ force: true }).catch(() => {});
    }
  }

  await humanPause(200, 500);
  await Promise.all([
    page.waitForURL((u) => !/\/Identity\/Account\/Login/i.test(u.href), {
      timeout: NAV_MS,
    }),
    page.locator('#login-submit').click(),
  ]);

  return { loggedIn: true, loginSkipped: false };
}

/**
 * Počká na AJAX summary (handler) nebo naplněné KPI buňky.
 * @param {import('playwright').Page} page
 */
async function waitForWarehouseSummary(page) {
  const cards = page.locator('#wh-dash-cards');
  await cards.waitFor({ state: 'visible', timeout: NAV_MS });

  const summaryPromise = page
    .waitForResponse(
      (res) =>
        /Warehouse/i.test(res.url()) &&
        /handler=Summary/i.test(res.url()) &&
        res.ok(),
      { timeout: SUMMARY_WAIT_MS },
    )
    .catch(() => null);

  await summaryPromise;

  // I když response nestihne (cache / SSR), počkej na neprázdný stockPieces / stockValue
  const deadline = Date.now() + SUMMARY_WAIT_MS;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const stock = document
        .querySelector('[data-cell="stockPieces"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
      const value = document
        .querySelector('[data-cell="stockValue"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
      const pick = document
        .querySelector('[data-cell="toPickOrders"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
      // Summary JS často přepisuje všechny buňky najednou — stačí že stockPieces má číslo
      return Boolean(stock || value || pick === '0');
    });
    if (ready) {
      await humanPause(200, 500);
      return;
    }
    await page.waitForTimeout(400);
  }

  console.log(
    '[warehouse] Timeout čekání na summary — beru DOM jak je.',
  );
}

/**
 * @param {import('playwright').Page} page
 */
async function extractWarehouseDashboard(page) {
  return page.evaluate((defs) => {
    const norm = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    /** @type {{ section: string, label: string, key: string, value: string, sub: string | null }[]} */
    const metrics = [];
    for (const d of defs) {
      const valEl = document.querySelector(`[data-cell="${d.cell}"]`);
      const value = norm(valEl?.textContent);
      if (value === '') {
        continue;
      }
      let sub = null;
      if (d.sub) {
        const subEl = document.querySelector(`[data-cell="${d.sub}"]`);
        const subText = norm(subEl?.textContent);
        if (subText) {
          sub = subText;
        }
      }
      metrics.push({
        section: d.section,
        label: d.label,
        key: d.key,
        value,
        sub,
      });
    }

    /** @type {{ count: string, label: string, href: string | null }[]} */
    const attention = [];
    document
      .querySelectorAll('#wh-dash-attention a.wh-dash-attention-item')
      .forEach((a) => {
        const count = norm(
          a.querySelector('.wh-dash-attention-count')?.textContent,
        );
        const clone = /** @type {HTMLElement} */ (a.cloneNode(true));
        clone.querySelector('.wh-dash-attention-count')?.remove();
        attention.push({
          count: count || '0',
          label: norm(clone.textContent),
          href: a.getAttribute('href'),
        });
      });

    return { metrics, attention };
  }, KPI_CELLS);
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 */
async function scrapeWarehouseOnce(page, context) {
  await humanPause(300, 800);
  await page.goto(config.crmWarehouseUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_MS,
  });
  await humanPause(400, 900);

  let loginMeta = { loggedIn: true, loginSkipped: true };
  if (isLoginUrl(page)) {
    loginMeta = await loginIfNeeded(page);
    await humanPause(300, 700);
    // Po loginu ReturnUrl může být Warehouse; pokud ne, jdi znovu
    if (!/\/Warehouse(\?|$)/i.test(page.url())) {
      await page.goto(config.crmWarehouseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_MS,
      });
    }
  }

  if (isLoginUrl(page)) {
    return {
      job: 'warehouseDashboard',
      ok: false,
      loggedIn: false,
      loginSkipped: false,
      url: page.url(),
      title: await page.title(),
      error: 'Po loginu jsme stále na login stránce',
    };
  }

  await waitForWarehouseSummary(page);
  const extracted = await extractWarehouseDashboard(page);
  await saveStorageState(context, config.crmStorageStatePath);

  console.log('[warehouse] metrics:', extracted.metrics.length);
  for (const m of extracted.metrics) {
    const sub = m.sub ? ` (${m.sub})` : '';
    console.log(`  [${m.section}] ${m.label}: ${m.value}${sub}`);
  }
  if (extracted.attention.length) {
    console.log('[warehouse] attention:');
    for (const a of extracted.attention) {
      console.log(`  ${a.count} — ${a.label}`);
    }
  }

  return {
    job: 'warehouseDashboard',
    ok: extracted.metrics.length > 0,
    loggedIn: loginMeta.loggedIn,
    loginSkipped: loginMeta.loginSkipped,
    url: page.url(),
    title: await page.title(),
    dashboard: {
      ok: extracted.metrics.length > 0,
      metrics: extracted.metrics,
      attention: extracted.attention,
    },
  };
}

/**
 * YG-CRM Warehouse dashboard scrape.
 */
export async function runWarehouseDashboard() {
  if (!config.warehouseScrapeEnabled) {
    logRun('Warehouse scrape vypnutý (WAREHOUSE_SCRAPE_ENABLED=false).');
    return {
      job: 'warehouseDashboard',
      ok: true,
      skipped: true,
      reason: 'disabled_by_env',
    };
  }

  const storagePath = config.crmStorageStatePath;

  return withBrowser(async (browser) => {
    if (storageFileExists(storagePath)) {
      try {
        const restored = await withHumanizedContext(
          browser,
          async (page, context) => {
            const result = await scrapeWarehouseOnce(page, context);
            if (!result.ok && /login/i.test(result.error || '')) {
              removeStorageStateFile(storagePath);
              return { useFull: true };
            }
            // Pokud session umřela, scrapeWarehouseOnce se sám přihlásí
            return { useFull: false, result };
          },
          { storageStateFile: storagePath },
        );
        if (!restored.useFull && restored.result) {
          return attachWarehouseIngest(restored.result);
        }
      } catch (e) {
        removeStorageStateFile(storagePath);
        logError('crm session restore', e);
      }
    }

    const fresh = await withHumanizedContext(browser, async (page, context) =>
      scrapeWarehouseOnce(page, context),
    );
    return attachWarehouseIngest(fresh);
  });
}
