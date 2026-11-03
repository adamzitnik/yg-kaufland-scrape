/**
 * Swifty ads tip modal (`dialog.swifty-modal`) překrývá dashboard a blokuje kliky.
 * Zavíráme křížkem nebo „Remind me later“ — nikdy „Continue“ (to by spustilo kampaně).
 */
const MODAL_WAIT_MS = 4_000;
const AFTER_HIDE_MS = 8_000;

/**
 * @param {import('playwright').Page} page
 */
export async function dismissSwiftyModalIfPresent(page) {
  const modal = page.locator('dialog.swifty-modal[open], dialog.bi-modal.swifty-modal');

  try {
    await modal.first().waitFor({ state: 'visible', timeout: MODAL_WAIT_MS });
  } catch {
    return;
  }

  // V headeru je jediné bi-link tlačítko = křížek (ne Continue).
  const closeBtn = modal.first().locator('header.bi-modal__header button.bi-link').first();
  const remindLater = modal
    .first()
    .locator('button.swifty-modal__footer-remind, button:has-text("Remind me later")')
    .first();

  let closed = false;

  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 8_000, force: true }).catch(() => {});
    closed = true;
    console.log('[dashboard] Swifty modal: zavřeno křížkem');
  }

  if (!closed && (await remindLater.isVisible().catch(() => false))) {
    await remindLater.click({ timeout: 8_000, force: true }).catch(() => {});
    closed = true;
    console.log('[dashboard] Swifty modal: Remind me later');
  }

  if (!closed) {
    // Poslední pokus: Escape na otevřeném dialogu
    await page.keyboard.press('Escape').catch(() => {});
  }

  await modal
    .first()
    .waitFor({ state: 'hidden', timeout: AFTER_HIDE_MS })
    .catch(() => {});

  // Některé instance nechají dialog v DOM bez open — odstraň open atribut / skryj
  const stillOpen = await modal.first().isVisible().catch(() => false);
  if (stillOpen) {
    await page
      .evaluate(() => {
        document.querySelectorAll('dialog.swifty-modal').forEach((d) => {
          if (typeof d.close === 'function') {
            try {
              d.close();
            } catch {
              /* ignore */
            }
          }
          d.removeAttribute('open');
          d.style.display = 'none';
        });
        const wrap = document.querySelector('.dashboard-global__modals');
        if (wrap) {
          wrap
            .querySelectorAll('dialog.swifty-modal')
            .forEach((d) => d.remove());
        }
      })
      .catch(() => {});
  }
}
