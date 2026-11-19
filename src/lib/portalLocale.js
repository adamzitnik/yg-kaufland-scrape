import { humanPause } from './humanize.js';

const LOCALE_WAIT_MS = 8_000;

function isEnglishLabel(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^english$/i.test(t) || /^en([-_]|$)/i.test(t);
}

/**
 * Collapsed sidebar schovává text — hover na footer / globe ikonu ho vyjede.
 * @param {import('playwright').Page} page
 */
async function revealSidebarLocale(page) {
  const targets = [
    page.locator('.sp-sidebar-footer').first(),
    page.locator('.bi-sidebar__footer').first(),
    page.locator('.bi-menu__prepend-icon title').filter({ hasText: /international/i }).first(),
    page
      .locator('.bi-menu')
      .filter({ has: page.locator('title', { hasText: /international/i }) })
      .locator('button.bi-menu__button')
      .first(),
    page.locator('.bi-sidebar').first(),
  ];

  for (const el of targets) {
    const visible = await el.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await el.hover({ timeout: 5_000 }).catch(() => {});
    await humanPause(120, 280);
  }
}

/**
 * Seller Portal locale je v sidebar footeru (`.bi-locale-select__label`).
 * Collapsed menu vyžaduje hover; pak případně přepne na English.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true = English (už bylo / přepnuto)
 */
export async function ensurePortalEnglish(page) {
  await revealSidebarLocale(page);

  const label = page.locator('.bi-locale-select__label').first();

  try {
    await label.waitFor({ state: 'visible', timeout: LOCALE_WAIT_MS });
  } catch {
    // druhý pokus: delší hover na celý sidebar
    await page.locator('.bi-sidebar').first().hover().catch(() => {});
    await humanPause(200, 450);
    await page
      .locator('.sp-sidebar-footer, .bi-sidebar__footer')
      .first()
      .hover()
      .catch(() => {});
    await humanPause(150, 350);

    try {
      await label.waitFor({ state: 'visible', timeout: LOCALE_WAIT_MS });
    } catch {
      console.log('[locale] .bi-locale-select__label nenalezen (i po hover) — skip');
      return false;
    }
  }

  const current = ((await label.textContent()) || '').replace(/\s+/g, ' ').trim();
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

  await revealSidebarLocale(page);

  try {
    await label.waitFor({ state: 'visible', timeout: LOCALE_WAIT_MS });
    const after = ((await label.textContent()) || '').replace(/\s+/g, ' ').trim();
    if (isEnglishLabel(after)) {
      console.log('[locale] přepnuto na English');
      return true;
    }
    console.log(`[locale] po kliku label="${after}" (očekáváno English)`);
    return isEnglishLabel(after);
  } catch {
    console.log('[locale] po přepnutí label znovu nenalezen');
    return false;
  }
}
