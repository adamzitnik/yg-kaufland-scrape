/**
 * Volání Laravel API (nastavení scrapu, později ingest).
 */

const INGEST_URL_RAW = process.env.SCRAPE_INGEST_URL?.trim();
const SETTINGS_URL_RAW = process.env.SCRAPE_SETTINGS_URL?.trim();

const API_BASE = process.env.SCRAPE_API_BASE?.trim().replace(/\/$/, '');

/** Pevné cesty (varianta B — `SCRAPE_API_BASE`). */
const INGEST_PATH = '/kaufland/scrape-ingest';
const SETTINGS_PATH = '/kaufland/scrape-settings';

function joinBasePath(base, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function resolveIngestUrl() {
  if (INGEST_URL_RAW) {
    return INGEST_URL_RAW;
  }
  if (API_BASE) {
    return joinBasePath(API_BASE, INGEST_PATH);
  }
  return '';
}

function resolveSettingsUrl() {
  if (SETTINGS_URL_RAW) {
    return SETTINGS_URL_RAW;
  }
  if (API_BASE) {
    return joinBasePath(API_BASE, SETTINGS_PATH);
  }
  return '';
}

const INGEST_URL = resolveIngestUrl();
const SETTINGS_URL = resolveSettingsUrl();

const CONTROL_HASH = process.env.SCRAPE_CONTROL_HASH?.trim();
const INGEST_HASH = process.env.SCRAPE_INGEST_HASH?.trim();

/** Názvy hlaviček (fixně dle backend kontraktu) */
const HDR_CONTROL = 'X-Kaufland-Scrape-Ingest-Secret';
const HDR_INGEST = 'X-Kaufland-Scrape-Ingest-Secret';

const FETCH_TIMEOUT_MS = Number(process.env.SCRAPE_FETCH_TIMEOUT_MS ?? '30000');

/**
 * @typedef {object} KpiScrapeSettingsNormalized
 * @property {boolean} enabled
 * @property {string[] | null} storefronts — null = použít `config.cockpitStorefronts`
 * @property {string | null} email — null = použít `config.kauflandSellerEmail`
 */

/**
 * Laravel JSON: `kaufland_kpi_scrape_*`
 * @param {Record<string, unknown>} raw
 * @returns {KpiScrapeSettingsNormalized}
 */
export function normalizeKpiScrapeSettings(raw) {
  const v = raw ?? {};
  const en = v.kaufland_kpi_scrape_enabled;
  let enabled = true;
  if (en !== undefined && en !== null && en !== '') {
    const s = String(en).trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') {
      enabled = false;
    } else if (s === '1' || s === 'true' || s === 'yes' || s === 'on') {
      enabled = true;
    } else {
      enabled = Number(en) !== 0;
    }
  }

  let storefronts = null;
  const sfRaw = v.kaufland_kpi_scrape_storefronts;
  if (sfRaw !== undefined && sfRaw !== null && String(sfRaw).trim() !== '') {
    const list = String(sfRaw)
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (list.length) {
      storefronts = list;
    }
  }

  let email = null;
  const em = v.kaufland_kpi_scrape_email_login;
  if (em !== undefined && em !== null && String(em).trim() !== '') {
    email = String(em).trim();
  }

  return { enabled, storefronts, email };
}

/**
 * @typedef {object} ScrapePlanNormalized
 * @property {boolean} enabled
 * @property {string[] | null} storefronts
 * @property {string | null} email
 */

/**
 * Starší / obecné klíče (fallback).
 * @param {Record<string, unknown>} raw
 * @returns {ScrapePlanNormalized}
 */
export function normalizeScrapePlan(raw) {
  const v = raw ?? {};
  const off =
    v.scrape_enabled === false ||
    v.enabled === false ||
    v.run === false ||
    v.run_scrape === false ||
    String(v.scrape_enabled).toLowerCase() === 'false';
  const enabled = !off;
  let storefronts = null;
  const sf = v.storefronts ?? v.storefront_codes ?? v.countries;
  if (Array.isArray(sf)) {
    storefronts = sf.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  return {
    enabled,
    storefronts: storefronts?.length ? storefronts : null,
    email: null,
  };
}

function normalizeSettingsResponse(raw) {
  const v = raw ?? {};
  if (
    v.kaufland_kpi_scrape_enabled !== undefined ||
    v.kaufland_kpi_scrape_storefronts !== undefined ||
    v.kaufland_kpi_scrape_email_login !== undefined
  ) {
    return normalizeKpiScrapeSettings(raw);
  }
  return normalizeScrapePlan(raw);
}

/**
 * GET `…/kaufland/scrape-settings` (nebo `SCRAPE_SETTINGS_URL`). Stejná hlavička jako u control (`SCRAPE_CONTROL_HASH`).
 * @returns {Promise<ScrapePlanNormalized | null>} `null` = bez `SCRAPE_API_BASE` / URL a hashe → lokální režim
 */
export async function fetchScrapeSettings() {
  if (!SETTINGS_URL || !CONTROL_HASH) {
    return null;
  }
  const headers = { [HDR_CONTROL]: CONTROL_HASH };
  const res = await fetch(SETTINGS_URL, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const bodySnippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(
      [
        `SCRAPE_SETTINGS HTTP ${res.status}`,
        `url=${SETTINGS_URL}`,
        `authHeader=${HDR_CONTROL}`,
        `authHeaderPresent=${Boolean(CONTROL_HASH)}`,
        bodySnippet ? `body="${bodySnippet}"` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }
  const raw = /** @type {Record<string, unknown>} */ (await res.json());
  return normalizeSettingsResponse(raw);
}

/** @deprecated alias — použij `fetchScrapeSettings` */
export async function fetchScrapePlan() {
  return fetchScrapeSettings();
}

/**
 * POST výsledků po scrapu.
 * @param {unknown} payload
 */
export async function postScrapeResult(payload) {
  if (!INGEST_URL || !INGEST_HASH) {
    return { skipped: true };
  }
  const body = JSON.stringify(payload);
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      [HDR_INGEST]: INGEST_HASH,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SCRAPE_INGEST HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return { ok: true, status: res.status };
}
