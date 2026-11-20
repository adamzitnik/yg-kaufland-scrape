import { humanPause } from './humanize.js';

const LOCALE_WAIT_MS = 8_000;

function isEnglishLabel(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^english$/i.test(t) || /^en([-_]|$)/i.test(t);
}

/**
 * Odjet myší ze sidebaru + Escape, ať expanded aside neblokuje taby.
 * @param {import('playwright').Page} page
 */
async function collapseSidebarOverlay(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  await page.mouse
    .move(Math.floor(vp.width * 0.55), Math.floor(vp.height * 0.4), {
      steps: 6,
    })
    .catch(() => {});
  await humanPause(80, 180);
  // Klik do hlavní plochy (ne do aside) — zavře hover-expanded sidebar
  await page
    .locator(
      '.health-dashboard, .bi-nav-tab-container, main, [class*="dashboard-global"]',
    )
    .first()
    .click({ timeout: 3_000, position: { x: 40, y: 40 } })
    .catch(() => {});
  await humanPause(80, 160);
}

/**
 * Když dashboard labely už vypadají anglicky, sidebar vůbec nesahej.
 * @param {import('playwright').Page} page
 */
async function dashboardLooksEnglish(page) {
  return page
    .evaluate(() => {
      const labels = Array.from(
        document.querySelectorAll('.health-dashboard__header-label'),
      ).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
      if (!labels.length) {
        return false;
      }
      const en =
        /Seller-related cancellation|Ticket response|Tracking rate|Total revenue|BuyBox share|Total order|Total offers|Sellable offers|Out of stock/i;
      const de =
        /Stornierungsrate|Gesamtumsatz|BuyBox-Anteil|Angebote insgesamt|Verkaufsfähige|Nicht vorrätig|Fehlende Produktdaten/i;
      const joined = labels.join(' | ');
      return en.test(joined) && !de.test(joined);
    })
    .catch(() => false);
}

/**
 * Collapsed sidebar schovává text — opatrný hover jen na footer (ne celý aside).
 * @param {import('playwright').Page} page
 */
async function revealSidebarLocale(page) {
  const footer = page
    .locator('.sp-sidebar-footer, .bi-sidebar__footer')
    .first();
  if (await footer.isVisible().catch(() => false)) {
    await footer.hover({ timeout: 5_000 }).catch(() => {});
    await humanPause(150, 320);
    return;
  }

  const globeBtn = page
    .locator('.bi-menu')
    .filter({ has: page.locator('title', { hasText: /international/i }) })
    .locator('button.bi-menu__button')
    .first();
  if (await globeBtn.isVisible().catch(() => false)) {
    await globeBtn.hover({ timeout: 5_000 }).catch(() => {});
    await humanPause(150, 320);
  }
}

/**
 * Seller Portal locale je v sidebar footeru (`.bi-locale-select__label`).
 * Po práci se sidebar vždy sbalí — jinak interceptuje kliky na taby.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true = English (už bylo / přepnuto)
 */
export async function ensurePortalEnglish(page) {
  if (await dashboardLooksEnglish(page)) {
    console.log('[locale] dashboard labely už EN — sidebar skip');
    await collapseSidebarOverlay(page);
    return true;
  }

  try {
    await revealSidebarLocale(page);

    const label = page.locator('.bi-locale-select__label').first();

    try {
      await label.waitFor({ state: 'visible', timeout: LOCALE_WAIT_MS });
    } catch {
      console.log('[locale] .bi-locale-select__label nenalezen — skip');
      return false;
    }

    const current = ((await label.textContent()) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isEnglishLabel(current)) {
      console.log('[locale] už English');
      return true;
    }

    console.log(`[locale] aktuálně "${current}" → přepínám na English`);

    const menuRoot = page
      .locator('.bi-menu')
      .filter({ has: page.locator('.bi-locale-select__label') })
      .first();
    const openBtn = menuRoot.locator('button.bi-menu__button').first();

    await humanPause(80, 200);
    await openBtn.click({ timeout: 10_000 }).catch(async () => {
      await label.click({ timeout: 10_000, force: true });
    });
    await humanPause(150, 350);

    const englishItem = page
      .locator(
        [
          '[role="menuitem"]',
          '.bi-menu__item',
          '.bi-dropdown-item',
          '.bi-select-option',
          'li',
          'button',
          'a',
        ].join(', '),
      )
      .filter({ hasText: /^\s*English\s*$/i })
      .first();

    try {
      await englishItem.waitFor({ state: 'visible', timeout: LOCALE_WAIT_MS });
      await englishItem.click({ timeout: 10_000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[locale] English položka nenalezena/nekliknutelná — ${msg}`);
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    await page
      .waitForLoadState('domcontentloaded', { timeout: 30_000 })
      .catch(() => {});
    await humanPause(400, 900);

    console.log('[locale] přepnuto (klik English)');
    return true;
  } finally {
    await collapseSidebarOverlay(page);
  }
}
