import { config, globalPerformanceDashboardUrl } from '../config.js';
import { dismissOnetrustIfPresent } from '../lib/onetrust.js';
import { dismissSwiftyModalIfPresent } from '../lib/swiftyModal.js';
import { humanPause, jitterMouse } from '../lib/humanize.js';

const KPI_WAIT_MS = 90_000;
const DETAIL_WAIT_MS = 45_000;

/** @type {ReadonlyArray<{ tabId: string, section: string }>} */
const DASHBOARD_TABS = [
  { tabId: 'performance', section: 'Performance' },
  { tabId: 'sales', section: 'Sales' },
  { tabId: 'assortment', section: 'Product range' },
];

/**
 * Detail enrichment rules: tabulka má bucket/zaokrouhlení, přesné % je na detail stránce.
 * @typedef {{
 *   key: string,
 *   labelRe: RegExp,
 *   pathRe: RegExp,
 *   extract: (page: import('playwright').Page) => Promise<string | null>,
 * }} DetailEnrichment
 */

/**
 * Extrahuje KPI z aktuálně viditelné health-dashboard tabulky.
 * Storefront bere z libovolného `a[href*="storefront="]` v řádku (sloupec i buňky).
 * U klikacích buněk přidá `href` (pro enrichment detailů).
 * @param {import('playwright').Page} page
 * @param {string} section
 */
async function extractHealthDashboardTable(page, section) {
  return page.evaluate((sectionName) => {
    /**
     * @typedef {{ section: string, label: string, value: string, status: string | null, href?: string }} Metric
     * @typedef {{ storefront: string, metrics: Metric[] }} Block
     */
    /** @type {Block[]} */
    const blocks = [];

    const root =
      document.querySelector('.health-dashboard') ||
      document.querySelector('.health-dashboard__table') ||
      document.body;

    const labels = Array.from(
      root.querySelectorAll('.health-dashboard__header-label'),
    )
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);

    const rows = root.querySelectorAll(
      '.health-dashboard__list .bi-list__item, .bi-list.health-dashboard__list .bi-list__item',
    );

    const statusFromCell = (cell) => {
      if (!cell) {
        return null;
      }
      if (cell.querySelector('.base-cell--danger, .cell-renderer--danger')) {
        return 'Critical';
      }
      if (cell.querySelector('.base-cell--warning, .cell-renderer--warning')) {
        return 'Needs Improvement';
      }
      const raw =
        cell.querySelector('.numeric-cell__value, .text-cell__value')
          ?.textContent ||
        cell.querySelector('.non-applicable-cell p')?.textContent ||
        cell.textContent ||
        '';
      const value = raw.replace(/\s+/g, ' ').trim();
      if (!value || /^n\/?a$/i.test(value)) {
        return null;
      }
      return 'Good';
    };

    const valueFromCell = (cell) => {
      if (!cell) {
        return '';
      }
      const link = cell.querySelector(
        '.numeric-cell__value, .text-cell__value',
      );
      if (link) {
        return link.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      }
      const na = cell.querySelector('.non-applicable-cell p');
      if (na) {
        return na.textContent?.replace(/\s+/g, ' ').trim() ?? 'N/A';
      }
      return cell.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    };

    const hrefFromCell = (cell) => {
      if (!cell) {
        return '';
      }
      const a = cell.querySelector(
        'a.numeric-cell__value[href], a.text-cell__value[href], a[href]',
      );
      return a?.getAttribute('href')?.trim() || '';
    };

    const storefrontFromHref = (href) => {
      if (!href) {
        return '';
      }
      try {
        const u = new URL(href, window.location.origin);
        return (u.searchParams.get('storefront') || '').trim().toLowerCase();
      } catch {
        const m = href.match(/[?&]storefront=([a-z]+)/i);
        return (m?.[1] || '').toLowerCase();
      }
    };

    rows.forEach((row) => {
      let storefront = '';
      const links = row.querySelectorAll('a[href*="storefront="]');
      for (const a of links) {
        storefront = storefrontFromHref(a.getAttribute('href') || '');
        if (storefront) {
          break;
        }
      }
      if (!storefront) {
        return;
      }

      const cells = Array.from(row.querySelectorAll('.bi-col')).filter(
        (col) => !col.classList.contains('health-dashboard__storefront'),
      );

      /** @type {Metric[]} */
      const metrics = [];
      labels.forEach((label, i) => {
        const cell = cells[i];
        const value = valueFromCell(cell);
        if (!value) {
          return;
        }
        /** @type {Metric} */
        const metric = {
          section: sectionName,
          label,
          value,
          status: statusFromCell(cell),
        };
        const href = hrefFromCell(cell);
        if (href) {
          metric.href = href;
        }
        metrics.push(metric);
      });

      if (metrics.length) {
        blocks.push({ storefront, metrics });
      }
    });

    return blocks;
  }, section);
}

/**
 * @param {import('playwright').Page} detailPage
 * @param {string} waitSelector
 */
async function waitDetailReady(detailPage, waitSelector) {
  await detailPage
    .locator(waitSelector)
    .first()
    .waitFor({ state: 'visible', timeout: DETAIL_WAIT_MS })
    .catch(() => {});
  await humanPause(120, 280);
}

/**
 * Z detailu bad-cancel-rates: „Calculated seller-related cancellation rate: X%“.
 * @param {import('playwright').Page} detailPage
 * @returns {Promise<string | null>}
 */
async function extractCalculatedCancellationRate(detailPage) {
  await waitDetailReady(
    detailPage,
    '.bad-cancel-overview, .rd-kpi-statistics, .performance-page',
  );

  return detailPage.evaluate(() => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const nodes = document.querySelectorAll(
      '.bad-cancel-overview__fee-bucket strong, .bad-cancel-overview strong, strong',
    );
    for (const el of nodes) {
      const text = normalize(el.textContent);
      const m = text.match(
        /Calculated\s+seller-related\s+cancellation\s+rate\s*:\s*([\d]+(?:[.,]\d+)?)\s*%/i,
      );
      if (m) {
        return `${m[1].replace(',', '.')}%`;
      }
    }
    const body = normalize(document.body?.innerText || '');
    const fallback = body.match(
      /Calculated\s+seller-related\s+cancellation\s+rate\s*:\s*([\d]+(?:[.,]\d+)?)\s*%/i,
    );
    return fallback ? `${fallback[1].replace(',', '.')}%` : null;
  });
}

/**
 * Z detailu delivery-rates: doughnut label „Delayed delivery rate“ → např. 5.3%.
 * @param {import('playwright').Page} detailPage
 * @returns {Promise<string | null>}
 */
async function extractDelayedDeliveryRate(detailPage) {
  await waitDetailReady(
    detailPage,
    '.delivery-rates, .doughnut-chart, .performance-page',
  );

  return detailPage.evaluate(() => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const pctFrom = (text) => {
      const m = normalize(text).match(/([\d]+(?:[.,]\d+)?)\s*%/);
      return m ? `${m[1].replace(',', '.')}%` : null;
    };

    const labels = document.querySelectorAll('.doughnut-chart__value-label');
    for (const label of labels) {
      const footnote = normalize(
        label.querySelector('.doughnut-chart__value-label-footnote')
          ?.textContent || '',
      );
      if (!/delayed\s+delivery\s+rate/i.test(footnote)) {
        continue;
      }
      const exact = pctFrom(label.querySelector('h2')?.textContent || '');
      if (exact) {
        return exact;
      }
    }

    const active = document.querySelector(
      '.doughnut-chart__value-label--active h2',
    );
    const fromActive = pctFrom(active?.textContent || '');
    if (fromActive) {
      return fromActive;
    }

    const body = normalize(document.body?.innerText || '');
    const m = body.match(
      /([\d]+(?:[.,]\d+)?)\s*%\s*Delayed\s+delivery\s+rate/i,
    );
    return m ? `${m[1].replace(',', '.')}%` : null;
  });
}

/** @type {ReadonlyArray<DetailEnrichment>} */
const DETAIL_ENRICHMENTS = [
  {
    key: 'cancel',
    labelRe: /seller-related\s+cancellation\s+rate/i,
    pathRe: /\/performance\/delivery\/bad-cancel-rates/i,
    extract: extractCalculatedCancellationRate,
  },
  {
    key: 'delayed',
    labelRe: /delayed\s+delivery\s+rate/i,
    pathRe: /\/performance\/delivery\/delivery-rates/i,
    extract: extractDelayedDeliveryRate,
  },
];

/**
 * Doplní přesné % z detail stránek (cancellation + delayed delivery).
 * Původní hodnota z tabulky → `bucket`. N/A / bez href přeskočí. `href` smaže.
 * @param {import('playwright').Page} page
 * @param {{ storefront: string, ok: boolean, metrics: object[] }[]} storefrontBlocks
 */
async function enrichPerformanceDetailExacts(page, storefrontBlocks) {
  const context = page.context();
  const origin = (() => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return 'https://sellerportal.kaufland.de';
    }
  })();

  /** Jedna detail page na celý enrichment — méně RAM na Pi než newPage per metrika. */
  let detail = null;

  try {
    for (const block of storefrontBlocks) {
      if (!block.ok || !Array.isArray(block.metrics)) {
        continue;
      }

      for (const metric of block.metrics) {
        const href = typeof metric.href === 'string' ? metric.href : '';
        const rule = DETAIL_ENRICHMENTS.find(
          (r) =>
            r.labelRe.test(metric.label || '') || r.pathRe.test(href),
        );

        if (!rule) {
          continue;
        }
        if (!href || /^n\/?a$/i.test(String(metric.value || ''))) {
          continue;
        }
        if (!rule.pathRe.test(href)) {
          continue;
        }

        let absoluteHref = href;
        try {
          absoluteHref = new URL(href, origin).href;
        } catch {
          /* keep relative */
        }

        try {
          if (!detail || detail.isClosed()) {
            detail = await context.newPage();
          }
          await detail.goto(absoluteHref, {
            waitUntil: 'domcontentloaded',
            timeout: DETAIL_WAIT_MS,
          });
          await humanPause(80, 200);
          await dismissOnetrustIfPresent(detail);
          await dismissSwiftyModalIfPresent(detail);

          const exact = await rule.extract(detail);
          if (exact) {
            metric.bucket = metric.value;
            metric.value = exact;
            console.log(
              `[dashboard] ${rule.key} exact storefront=${block.storefront}: ${exact} (bucket ${metric.bucket})`,
            );
          } else {
            console.log(
              `[dashboard] ${rule.key} exact storefront=${block.storefront}: not found, keep ${metric.value}`,
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(
            `[dashboard] ${rule.key} exact storefront=${block.storefront}: fail — ${msg}`,
          );
          // Po pádu Chromium zkus znovu otevřít detail page
          if (detail && !detail.isClosed()) {
            await detail.close().catch(() => {});
          }
          detail = null;
        }

        await humanPause(60, 150);
      }

      for (const metric of block.metrics) {
        delete metric.href;
      }
    }
  } finally {
    if (detail && !detail.isClosed()) {
      await detail.close().catch(() => {});
    }
  }
}

/**
 * Globální Total sales z revenue bloku (pokud je na stránce).
 * @param {import('playwright').Page} page
 */
async function extractGlobalTotalSales(page) {
  return page.evaluate(() => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

    const roots = [
      ...document.querySelectorAll(
        '.revenue-insights, [class*="revenue-insight"], [class*="total-sales"]',
      ),
      document.body,
    ];

    for (const root of roots) {
      const walk = root.querySelectorAll(
        'h1, h2, h3, h4, p, span, div, strong, a',
      );
      for (const el of walk) {
        const text = normalize(el.textContent);
        if (!/^total sales$/i.test(text) && !/^gesamte verkäufe$/i.test(text)) {
          continue;
        }
        const container =
          el.closest(
            '.revenue-insights, [class*="revenue"], [class*="kpi"], [class*="card"], section, article',
          ) || el.parentElement;
        if (!container) {
          continue;
        }
        const money = normalize(container.textContent).match(
          /€\s*[\d.,]+|[\d.,]+\s*€/,
        );
        if (!money) {
          continue;
        }
        return {
          section: 'Revenue',
          label: 'Total sales',
          value: money[0].replace(/\s+/g, ' ').trim(),
          status: 'Good',
        };
      }
    }

    // Fallback: první výrazné € v .revenue-insights
    const rev = document.querySelector('.revenue-insights');
    if (rev) {
      const money = normalize(rev.textContent).match(/€\s*[\d.,]+|[\d.,]+\s*€/);
      if (money) {
        return {
          section: 'Revenue',
          label: 'Total sales',
          value: money[0].replace(/\s+/g, ' ').trim(),
          status: 'Good',
        };
      }
    }

    return null;
  });
}

/** Po přepnutí tabu ověř, že header tabulky patří dané sekci (ne starý DOM). */
const TAB_READY_LABEL = {
  performance: /Seller-related cancellation rate|Ticket response rate|Tracking rate/i,
  sales: /Total revenue|BuyBox share|Total orders/i,
  assortment: /Total offers|Sellable offers|Out of stock|Missing product data/i,
};

/**
 * Klikne na BI tab podle data-tab-id a počká na tabulku dané sekce.
 * @param {import('playwright').Page} page
 * @param {string} tabId
 */
async function activateDashboardTab(page, tabId) {
  await dismissSwiftyModalIfPresent(page);

  const tab = page.locator(`[data-tab-id="${tabId}"]`).first();
  await tab.waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

  const parentTab = tab.locator(
    'xpath=ancestor::*[contains(@class,"bi-nav-tab")][1]',
  );
  const alreadyActive = await parentTab
    .evaluate((el) =>
      /\bbi-nav-tab--primary--active\b/.test(el.className || ''),
    )
    .catch(() => false);

  if (!alreadyActive) {
    await humanPause(120, 280);
    await dismissSwiftyModalIfPresent(page);
    await tab.click({ timeout: 15_000 });
  }

  await page
    .locator('.health-dashboard__storefront')
    .first()
    .waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

  const labelRe = TAB_READY_LABEL[tabId];
  if (labelRe) {
    await page
      .waitForFunction(
        (reSource) => {
          const re = new RegExp(reSource, 'i');
          const labels = Array.from(
            document.querySelectorAll('.health-dashboard__header-label'),
          ).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
          return labels.some((t) => re.test(t));
        },
        labelRe.source,
        { timeout: KPI_WAIT_MS },
      )
      .catch(() => {
        console.log(
          `[dashboard] tab=${tabId}: header labels not ready in time, extracting anyway`,
        );
      });
  }

  await humanPause(180, 400);
}

/**
 * @param {Map<string, { storefront: string, metrics: object[] }>} map
 * @param {{ storefront: string, metrics: object[] }[]} blocks
 */
function mergeBlocksIntoMap(map, blocks) {
  for (const block of blocks) {
    const existing = map.get(block.storefront);
    if (existing) {
      existing.metrics.push(...block.metrics);
    } else {
      map.set(block.storefront, {
        storefront: block.storefront,
        metrics: [...block.metrics],
      });
    }
  }
}

/**
 * Přejde na global dashboard a vytáhne Performance + Sales + Product range (+ Total sales).
 * @param {import('playwright').Page} page
 * @param {{ skipGoto?: boolean }} [opts]
 */
export async function loadDashboardAndExtractKpis(page, opts = {}) {
  try {
    if (!opts.skipGoto) {
      await humanPause(200, 500);
      await page.goto(globalPerformanceDashboardUrl(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await humanPause(250, 600);
      await jitterMouse(page);
      await humanPause(280, 700);
      await dismissOnetrustIfPresent(page);
      await dismissSwiftyModalIfPresent(page);
    } else {
      await humanPause(120, 300);
      await dismissOnetrustIfPresent(page);
      await dismissSwiftyModalIfPresent(page);
    }

    const table = page.locator('.health-dashboard__table, .health-dashboard__list');
    await table.first().waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

    await page
      .locator('.health-dashboard__storefront')
      .first()
      .waitFor({ state: 'visible', timeout: KPI_WAIT_MS });

    // Modal často naskočí až po vykreslení tabulky
    await humanPause(150, 350);
    await dismissSwiftyModalIfPresent(page);

    /** @type {Map<string, { storefront: string, metrics: object[] }>} */
    const bySf = new Map();

    const globalTotalSales = await extractGlobalTotalSales(page);

    for (const { tabId, section } of DASHBOARD_TABS) {
      await activateDashboardTab(page, tabId);
      const blocks = await extractHealthDashboardTable(page, section);
      console.log(
        `[dashboard] tab=${tabId} section=${section}: ${blocks.length} storefront rows`,
      );
      mergeBlocksIntoMap(bySf, blocks);
    }

    if (globalTotalSales) {
      console.log(`[dashboard] Total sales (global): ${globalTotalSales.value}`);
    }

    return {
      ok: true,
      url: page.url(),
      metricsByStorefront: [...bySf.values()],
      globalMetrics: globalTotalSales ? [globalTotalSales] : [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      url: page.url(),
      metricsByStorefront: [],
      globalMetrics: [],
      error: msg,
    };
  }
}

/**
 * Načte KPI ze všech tabů global dashboardu, filtr podle settings/env.
 * @param {import('playwright').Page} page
 * @param {string[] | null | undefined} storefrontCodes — `null`/`undefined` = `config.cockpitStorefronts`
 * @param {{ skipGoto?: boolean }} [opts]
 */
export async function loadAllStorefrontKpis(page, storefrontCodes, opts = {}) {
  const wanted = new Set(
    (storefrontCodes?.length ? storefrontCodes : config.cockpitStorefronts).map(
      (s) => String(s).trim().toLowerCase(),
    ),
  );

  const extracted = await loadDashboardAndExtractKpis(page, {
    skipGoto: opts.skipGoto === true,
  });

  if (!extracted.ok) {
    return {
      ok: false,
      storefronts: [...wanted].map((sf) => ({
        storefront: sf,
        ok: false,
        url: extracted.url,
        metrics: [],
        error: extracted.error ?? 'fail',
      })),
      globalMetrics: [],
      error: extracted.error,
    };
  }

  const bySf = new Map(
    extracted.metricsByStorefront.map((b) => [b.storefront, b]),
  );

  /** @type {{ storefront: string, ok: boolean, url: string, metrics: object[], error?: string }[]} */
  const blocks = [];
  for (const sf of wanted) {
    const found = bySf.get(sf);
    if (!found) {
      blocks.push({
        storefront: sf,
        ok: false,
        url: extracted.url,
        metrics: [],
        error: `Storefront ${sf} nebyl v health-dashboard tabulce`,
      });
      console.log(`[dashboard] storefront=${sf}: missing in table`);
      continue;
    }
    blocks.push({
      storefront: sf,
      ok: true,
      url: extracted.url,
      metrics: found.metrics,
    });
  }

  // Přesné % z detailů (cancellation + delayed delivery); bucket = hodnota z tabulky
  await enrichPerformanceDetailExacts(page, blocks);

  return {
    ok: blocks.every((b) => b.ok),
    storefronts: blocks,
    globalMetrics: extracted.globalMetrics ?? [],
  };
}

/** Čitelný výpis jednoho seznamu metrik. */
export function printDashboardKpis(metrics) {
  if (!metrics.length) {
    console.log('[dashboard] Žádné KPI v DOM.');
    return;
  }
  console.log('');
  console.log('--- Dashboard KPI (health-dashboard) ---');
  for (const m of metrics) {
    const st = m.status ? ` — ${m.status}` : '';
    console.log(`[${m.section}] ${m.label}: ${m.value}${st}`);
  }
  console.log('-------------------------------------');
  console.log('');
}

/** Výpis všech storefrontů pod sebe. */
export function printAllStorefrontKpis(aggregated) {
  if (aggregated.globalMetrics?.length) {
    console.log('\n=== Global ===');
    for (const m of aggregated.globalMetrics) {
      const st = m.status ? ` — ${m.status}` : '';
      console.log(`  [${m.section}] ${m.label}: ${m.value}${st}`);
    }
  }
  for (const block of aggregated.storefronts) {
    console.log(`\n=== Storefront: ${block.storefront} ===`);
    if (!block.ok) {
      console.log('  (chyba)', block.error ?? '');
      continue;
    }
    for (const m of block.metrics) {
      const st = m.status ? ` — ${m.status}` : '';
      const bucket = m.bucket ? ` (bucket ${m.bucket})` : '';
      console.log(`  [${m.section}] ${m.label}: ${m.value}${bucket}${st}`);
    }
  }
  console.log('');
}
