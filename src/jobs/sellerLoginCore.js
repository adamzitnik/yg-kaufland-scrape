import { config } from '../config.js';
import { dismissOnetrustIfPresent } from '../lib/onetrust.js';
import {
  humanPause,
  humanType,
  jitterMouse,
  randomInt,
} from '../lib/humanize.js';

export const OTP_STEP_TIMEOUT_MS = 45_000;

/** Viditelný prvek naznačující krok OTP / 2FA. */
export function otpStepLocators(page) {
  return [
    page.getByPlaceholder(/security code|sicherheitscode/i),
    page.locator('.verify input[type="text"]').first(),
    page.locator('h1.verify__title'),
    page.locator('input[autocomplete="one-time-code"]'),
    page.locator('input[inputmode="numeric"][maxlength="6"]'),
    page.locator(
      'input[name*="otp"], input[name*="OTP"], input[name*="totp"], input[name*="TOTP"]',
    ),
    page.locator(
      'input[type="text"][name*="code"], input[type="tel"][name*="code"], input[type="text"][name*="Code"]',
    ),
    page.getByText(
      /authenticator|verification code|one-time|two-factor|2-factor|2FA|OTP|TOTP|Einmalcode|Bestätigungscode|Zwei[- ]Faktor|Sicherheitscode/i,
    ),
  ];
}

export async function waitForOtpStep(page) {
  const locators = otpStepLocators(page);
  await Promise.race(
    locators.map((loc) =>
      loc.first().waitFor({ state: 'visible', timeout: OTP_STEP_TIMEOUT_MS }),
    ),
  );
}

/**
 * Portál → lidské zadání přihlášení → OneTrust → Login → obrazovka OTP.
 * @param {import('playwright').Page} page
 * @param {{ email?: string }} [opts] — e-mail z Laravelu; jinak `KAUFLAND_SELLER_EMAIL`
 */
export async function loginThroughOtpPrompt(page, opts = {}) {
  const email = (opts.email ?? config.kauflandSellerEmail).trim();
  const password = config.kauflandSellerPassword;
  if (!email || !password) {
    throw new Error(
      'Chybí e-mail (Laravel / KAUFLAND_SELLER_EMAIL) nebo KAUFLAND_SELLER_PASSWORD v .env',
    );
  }

  await humanPause(350, 1100);
  await page.goto(config.portalEntryUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await humanPause(280, 950);
  await jitterMouse(page);
  await humanPause(120, 400);

  // Lišta často dorazí až po JS — zavřít dřív než cokoli v login formuláři
  await humanPause(600, 1800);
  await dismissOnetrustIfPresent(page);

  const userInput = page.locator('input[name="username"]');
  await userInput.waitFor({ state: 'visible', timeout: 60_000 });
  await dismissOnetrustIfPresent(page);
  await humanPause(80, 220);

  await userInput.click({ delay: randomInt(15, 70) });
  await humanPause(80, 220);
  await humanType(userInput, email);

  await humanPause(160, 520);
  const passInput = page.locator('input[name="password"]');
  await passInput.click({ delay: randomInt(15, 70) });
  await humanPause(60, 180);
  await humanType(passInput, password);

  await humanPause(180, 650);
  await dismissOnetrustIfPresent(page);
  await humanPause(90, 380);

  const loginBtn = page.getByRole('button', { name: 'Login', exact: true });
  await loginBtn.hover().catch(() => {});
  await humanPause(70, 240);
  await loginBtn.click();

  await waitForOtpStep(page);
}
