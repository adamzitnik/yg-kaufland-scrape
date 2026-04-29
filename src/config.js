import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const envTruthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const envFalsey = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());

/** Viditelné okno: HEADLESS=false nebo PLAYWRIGHT_HEADED=1 */
const headed =
  envFalsey(process.env.HEADLESS) || envTruthy(process.env.PLAYWRIGHT_HEADED);

const slowMoRaw = process.env.PLAYWRIGHT_SLOW_MO ?? '';
const slowMo = /^\d+$/.test(slowMoRaw) ? Number(slowMoRaw) : 0;

const DEFAULT_STOREFRONTS = [
  'de',
  'cz',
  'sk',
  'at',
  'pl',
  'fr',
  'it',
];

function parseStorefrontCsv(raw) {
  if (!raw?.trim()) {
    return [...DEFAULT_STOREFRONTS];
  }
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : [...DEFAULT_STOREFRONTS];
}

function resolveCockpitDashboardBase() {
  const fromEnv = process.env.COCKPIT_DASHBOARD_BASE?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const legacy = process.env.COCKPIT_DASHBOARD_URL?.trim();
  if (legacy) {
    try {
      const u = new URL(legacy);
      return `${u.origin}${u.pathname}`.replace(/\/$/, '');
    } catch {
      /* fallthrough */
    }
  }
  return 'https://sellerportal.kaufland.de/dashboard';
}

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? '3780'),
  workerSecret: process.env.WORKER_SECRET ?? '',
  portalEntryUrl:
    process.env.PORTAL_ENTRY_URL ?? 'https://sellerportal.kaufland.de',
  /** Např. `https://sellerportal.kaufland.de/dashboard` — storefront se doplňuje vždy v query */
  cockpitDashboardBaseUrl: resolveCockpitDashboardBase(),
  /** Pořadí načtení KPI (přímé `?storefront=` je spolehlivější než měnit roletku) */
  cockpitStorefronts: parseStorefrontCsv(process.env.COCKPIT_STOREFRONTS),
  /** Playwright storageState (cookies + localStorage) — výchozí pi-worker/var/storage-state.json */
  storageStatePath:
    process.env.PLAYWRIGHT_STORAGE_STATE?.trim() ||
    path.join(__dirname, '..', 'var', 'storage-state.json'),
  kauflandSellerEmail: process.env.KAUFLAND_SELLER_EMAIL ?? '',
  kauflandSellerPassword: process.env.KAUFLAND_SELLER_PASSWORD ?? '',
  /** Base32 TOTP secret z ručního zadání (mezeru otlib stejně ořeže přes normalizaci v jobu) */
  totpSecret: process.env.TOTP_SECRET ?? '',
  /** false = viditelný Chromium (ladění) */
  playwrightHeadless: !headed,
  /** ms mezi akcemi při ladění (0 = vypnuto) */
  playwrightSlowMo: slowMo,
};

/**
 * Plná URL dashboardu pro daný storefront (GET — bez roletky).
 * @param {string} storefront
 */
export function cockpitDashboardUrlForStorefront(storefront) {
  const sf = String(storefront ?? '')
    .trim()
    .toLowerCase();
  return `${config.cockpitDashboardBaseUrl}?storefront=${encodeURIComponent(sf)}`;
}
