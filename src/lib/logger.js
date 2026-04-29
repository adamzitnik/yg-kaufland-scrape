import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Denní soubory: `var/logs/run-YYYY-MM-DD.log`, `error-YYYY-MM-DD.log` */
export const LOG_DIR = path.join(__dirname, '..', 'var', 'logs');

const RUN_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.LOG_RUN_RETENTION_DAYS ?? '7'),
);
const ERR_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.LOG_ERROR_RETENTION_DAYS ?? '30'),
);

/** Minimální rozestup mezi procházením složky (ms) */
const PRUNE_INTERVAL_MS = Number(process.env.LOG_PRUNE_INTERVAL_MS ?? String(60 * 60 * 1000));

let lastPruneAt = 0;

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  }
}

/** Lokální kalendářní den pro název souboru (na Pi odpoví „dnům“ v cronu). */
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(y, monthIndex, day) {
  const t = new Date(y, monthIndex, day);
  t.setHours(0, 0, 0, 0);
  return t.getTime();
}

/**
 * Smaže soubory, jejichž datum v názvu je starší než retenční okno.
 */
export function pruneOldLogs() {
  ensureDir();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const runCutoff = new Date(todayStart);
  runCutoff.setDate(runCutoff.getDate() - RUN_RETENTION_DAYS);
  const errCutoff = new Date(todayStart);
  errCutoff.setDate(errCutoff.getDate() - ERR_RETENTION_DAYS);

  let names;
  try {
    names = fs.readdirSync(LOG_DIR);
  } catch {
    return;
  }

  const runRe = /^run-(\d{4})-(\d{2})-(\d{2})\.log$/;
  const errRe = /^error-(\d{4})-(\d{2})-(\d{2})\.log$/;

  for (const name of names) {
    let m = name.match(runRe);
    let cutoff = runCutoff.getTime();
    if (!m) {
      m = name.match(errRe);
      if (!m) {
        continue;
      }
      cutoff = errCutoff.getTime();
    }
    const fileDayStart = startOfLocalDay(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
    );
    if (fileDayStart < cutoff) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, name));
      } catch {
        /* ignore */
      }
    }
  }
}

function maybePrune() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;
  pruneOldLogs();
}

function appendToDaily(prefix, message) {
  ensureDir();
  maybePrune();
  const file = path.join(LOG_DIR, `${prefix}-${localDateStr()}.log`);
  fs.appendFileSync(file, message, { encoding: 'utf8' });
}

function ts() {
  return new Date().toISOString();
}

/** Běžné události — kratší retence dle `LOG_RUN_RETENTION_DAYS` (výchozí 7). */
export function logRun(message) {
  const line = `${ts()} ${message}\n`;
  appendToDaily('run', line);
}

/** Chyby — delší retence dle `LOG_ERROR_RETENTION_DAYS` (výchozí 30). */
export function logError(message, err = null) {
  const extra =
    err instanceof Error
      ? ` ${err.stack ?? err.message}`
      : err != null
        ? ` ${String(err)}`
        : '';
  const line = `${ts()} ${message}${extra}\n`;
  appendToDaily('error', line);
}
