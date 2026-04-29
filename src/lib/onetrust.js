/**
 * OneTrust cookie lišta překrývá formulář (policy text bere pointer events).
 * Accept klikáme force — jinak někdy pořád hlásí „intercepted“.
 */
const ACCEPT_VISIBLE_MS = 16_000;
const AFTER_CLICK_HIDE_MS = 15_000;

export async function dismissOnetrustIfPresent(page) {
  const sdk = page.locator('#onetrust-consent-sdk');
  const accept = page.locator('#onetrust-accept-btn-handler');

  try {
    await accept.waitFor({ state: 'visible', timeout: ACCEPT_VISIBLE_MS });
  } catch {
    return;
  }

  await accept.click({ timeout: 15_000, force: true });
  await sdk.waitFor({ state: 'hidden', timeout: AFTER_CLICK_HIDE_MS }).catch(() => {});
}
