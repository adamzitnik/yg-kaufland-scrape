import { withBrowser } from '../lib/browser.js';
import { withHumanizedContext } from '../lib/humanize.js';
import { config } from '../config.js';
import { loginThroughOtpPrompt } from './sellerLoginCore.js';

/**
 * Krok 1: portál → přihlášení → obrazovka OTP (bez vyplnění kódu).
 * Stejné „lidské“ chování jako plný login s TOTP.
 */
export async function runLoginEmailPassword() {
  if (!config.kauflandSellerEmail.trim() || !config.kauflandSellerPassword) {
    throw new Error(
      'Chybí KAUFLAND_SELLER_EMAIL nebo KAUFLAND_SELLER_PASSWORD v .env',
    );
  }

  return withBrowser(async (browser) => {
    return withHumanizedContext(browser, async (page) => {
      try {
        await loginThroughOtpPrompt(page);
      } catch {
        const url = page.url();
        const title = await page.title();
        const stillLogin =
          (await page
            .locator('input[name="username"]')
            .isVisible()
            .catch(() => false)) &&
          (await page
            .locator('input[name="password"]')
            .isVisible()
            .catch(() => false));
        return {
          job: 'loginEmailPassword',
          ok: false,
          reachedOtpStep: false,
          url,
          title,
          hint: stillLogin
            ? 'Stále viditelný login formulář — špatné údaje, captcha, nebo změna UI.'
            : 'Nepodařilo se do timeoutu najít OTP / 2FA prvek — zkontroluj URL a případně rozšiř selektory.',
        };
      }

      return {
        job: 'loginEmailPassword',
        ok: true,
        reachedOtpStep: true,
        url: page.url(),
        title: await page.title(),
      };
    });
  });
}
