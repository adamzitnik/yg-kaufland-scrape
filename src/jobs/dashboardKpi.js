import { config, cockpitDashboardUrlForStorefront } from '../config.js';
import { dismissOnetrustIfPresent } from '../lib/onetrust.js';
import { humanPause, jitterMouse } from '../lib/humanize.js';

const KPI_WAIT_MS = 90_000;

/**
 * Přejde na dashboard (storefront v URL — stejné chování jako ruční navigace),
 * počká na `.cockpit__kpi` a vytáhne dlaždice.
 * @param {import('playwright').Page} page
 * @param {{ skipGoto?: boolean, storefront?: string }} [opts]
 *   — `skipGoto: true` jen když už jsi na správném dashboardu (např. hned po probe).
 */
export async function loadDashboardAndExtractKpis(page, opts = {}) {
  try {
    if (!opts.skipGoto) {
      await humanPause(350, 1100);
      const sf = (opts.storefront ?? config.cockpitStorefronts[0]).trim();
      await page.goto(cockpitDashboardUrlForStorefront(sf), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await humanPause(450, 1300);
      await jitterMouse(page);
      await humanPause(500, 1600);
      await dismissOnetrustIfPresent(page);
    } else {
      await humanPause(200, 600);
      await dismissOnetrustIfPresent(page);
    }

    const cockpit = page.locator('.cockpit__kpi');
    await cockpit.waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

    await page
      .locator('.cockpit__kpi [class*="__kpi-value"]')
      .first()
      .waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

    const metrics = await cockpit.evaluate((root) => {
      /** @type {{ section: string, label: string, value: string, status: string | null }[]} */
      const rows = [];
      const sections = root.querySelectorAll(
        '.customer-satisfaction, .shipping-performance',
      );
      sections.forEach((sec) => {
        const sectionTitle =
          sec.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        const tiles = sec.querySelectorAll('.bi-tile');
        tiles.forEach((tile) => {
          const label = tile
            .querySelector('.bi-tile-base__headerContent')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim();
          if (!label) {
            return;
          }
          const valueEl = tile.querySelector('[class*="__kpi-value"]');
          const value = valueEl?.textContent?.trim() ?? '';
          const statusEl = tile.querySelector(
            '.kpi-tile-notification__content',
          );
          const status =
            statusEl?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
          if (value) {
            rows.push({ section: sectionTitle, label, value, status });
          }
        });
      });
      return rows;
    });

    return {
      ok: true,
      url: page.url(),
      metrics,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      url: page.url(),
      metrics: [],
      error: msg,
    };
  }
}

/**
 * Načte KPI pro všechny storefronty (agregace pro pozdější POST).
 * @param {import('playwright').Page} page
 * @param {string[] | null | undefined} storefrontCodes — `null`/`undefined` = `config.cockpitStorefronts`
 */
export async function loadAllStorefrontKpis(page, storefrontCodes) {
  const storefronts =
    storefrontCodes?.length ? storefrontCodes : config.cockpitStorefronts;
  /** @type {{ storefront: string, ok: boolean, url: string, metrics: unknown[], error?: string }[]} */
  const blocks = [];

  for (const sf of storefronts) {
    await humanPause(180, 520);
    const one = await loadDashboardAndExtractKpis(page, {
      storefront: sf,
      skipGoto: false,
    });
    blocks.push({
      storefront: sf,
      ok: one.ok,
      url: one.url,
      metrics: one.metrics,
      ...(one.error ? { error: one.error } : {}),
    });
    if (!one.ok) {
      console.log(`[dashboard] storefront=${sf}:`, one.error ?? 'fail');
    }
  }

  return {
    ok: blocks.every((b) => b.ok),
    storefronts: blocks,
  };
}

/** Čitelný výpis jednoho dashboardu. */
export function printDashboardKpis(metrics) {
  if (!metrics.length) {
    console.log('[dashboard] Žádné KPI v DOM.');
    return;
  }
  console.log('');
  console.log('--- Dashboard KPI (cockpit__kpi) ---');
  for (const m of metrics) {
    const st = m.status ? ` — ${m.status}` : '';
    console.log(`[${m.section}] ${m.label}: ${m.value}${st}`);
  }
  console.log('-------------------------------------');
  console.log('');
}

/** Výpis všech storefrontů pod sebe. */
export function printAllStorefrontKpis(aggregated) {
  for (const block of aggregated.storefronts) {
    console.log(`\n=== Storefront: ${block.storefront} ===`);
    if (!block.ok) {
      console.log('  (chyba)', block.error ?? '');
      continue;
    }
    for (const m of block.metrics) {
      const st = m.status ? ` — ${m.status}` : '';
      console.log(`  [${m.section}] ${m.label}: ${m.value}${st}`);
    }
  }
  console.log('');
}
