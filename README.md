# Pi worker (Raspberry Pi 5 · 4 GB)

Playwright potřebuje **Node.js 18+** (doporučeno **20 LTS** – viz `.nvmrc`). Na Pi 5 nainstaluj Node 20; na Macu bez nového Node `npm run job:ping` nespustíš.

## Lokálně (Mac / PC)

```bash
cd pi-worker
nvm use   # nebo jinak přepni na Node 20+
cp .env.example .env
npm install
npm run job:ping
npm run job:login
npm run job:login-totp
```

`npm install` stáhne Chromium přes `postinstall` (může chvíli trvat).

`job:login` potřebuje `KAUFLAND_SELLER_EMAIL` a `KAUFLAND_SELLER_PASSWORD` v `.env`. Výstup: `reachedOtpStep: true` pokud se objeví OTP / 2FA obrazovka (bez vyplnění kódu).

`job:login-totp` navíc `TOTP_SECRET`: po přihlášení projde storefronty z `COCKPIT_STOREFRONTS`, nebo — pokud je v `.env` **`SCRAPE_API_BASE`** + **`SCRAPE_CONTROL_HASH`** — z Laravel GET **`…/kaufland/scrape-settings`** (`kaufland_kpi_scrape_storefronts`). Při `kaufland_kpi_scrape_enabled` vypnutém job skončí s `skipped: true`. E-mail loginu může přijít z API (`kaufland_kpi_scrape_email_login`), heslo a TOTP zůstávají v `.env`. U každého storefrontu udělá **`page.goto`** na `COCKPIT_DASHBOARD_BASE?storefront=…`. Výstup v JSON: **`dashboard.storefronts[]`**, volitelně **`scrapeSettings`**; na konzoli přes **`printAllStorefrontKpis`**.

Login joby používají **`humanize`**: náhodný viewport, běžný Chrome User-Agent, `de-DE` / `Europe/Berlin`, pauzy mezi kroky a `pressSequentially` místo okamžitého `fill()`.

### Uložená relace (bez opakovaného loginu)

Po úspěšném `loginWithTotp` se uloží **`storageState`** (výchozí `pi-worker/var/storage-state.json`, přepis přes `PLAYWRIGHT_STORAGE_STATE`).

Další běh nejdřív načte tento soubor, otevře dashboard a **`probeSellerSession`**:

- **`logged_in`** → přeskočí e-mail/heslo/OTP, projde storefronty (KPI podle API nebo `COCKPIT_STOREFRONTS`) a znovu uloží stav.
- **`need_password`**, **`need_otp`**, **`unknown`** → soubor relace smaže a proběhne celý login znovu.

Soubor `var/` je v `.gitignore` (citlivé cookies).

**Viditelný prohlížeč (ladění):** v `.env` nastav `HEADLESS=false` nebo `PLAYWRIGHT_HEADED=1`. Volitelně `PLAYWRIGHT_SLOW_MO=150` zpomalí kliky/písání. Na Pi / serveru nech výchozí headless.

Před klikem na Login se automaticky zavře OneTrust cookie lišta (`#onetrust-accept-btn-handler`), pokud je na stránce.

Server:

```bash
npm start
# GET http://127.0.0.1:3780/health
# POST http://127.0.0.1:3780/run  body: {"job":"pingPortal"}
# POST … body: {"job":"loginEmailPassword"}
# POST … body: {"job":"loginWithTotp"}
```

## Raspberry Pi 5 (64bit Raspberry Pi OS)

1. Nainstaluj [Node 20+](https://github.com/nodesource/distributions) nebo `nvm`.
2. Závislosti prohlížeče (jednorázově):

   ```bash
   sudo apt-get update
   sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
   ```

   (Playwright umí i `npx playwright install-deps chromium` na Debianu – případně doplň podle výpisu.)

3. V adresáři `pi-worker`: `cp .env.example .env`, uprav `PORT` / `WORKER_SECRET` / `HOST`.
4. `npm install`
5. Systemd: uprav a zkopíruj `../deploy/raspberry-pi5/kaufland-portal-worker.service.example`, pak `systemctl enable --now …`.

## Bezpečnost

- V produkci nastav `WORKER_SECRET` a posílej ho v hlavičce `X-Worker-Secret` u `POST /run`.
- `HOST=127.0.0.1` pokud k workeru přistupuješ jen z téže mašiny (nebo přes reverzní proxy s auth).
- V kořeni repa je **`.cursorignore`** – aby Cursor neindexoval `.env` a citlivé soubory (agent je pak typicky nevidí). Stejně **neposílej** hesla ani secret do chatu.

## Propojení s PHP

Z XAMPPu můžeš volat `curl` na `http://PI_IP:3780/run` (nebo Tailscale IP), s JSON tělem a hlavičkou tajemství – až přidáme job pro login/OTP, rozšíří se jen `jobs/`.

## Laravel řízení + logy (kontury)

Modul **`src/lib/scrapeRemote.js`**: **`fetchScrapeSettings()`** — GET **`SCRAPE_API_BASE` + `/kaufland/scrape-settings`** (fixní hlavička **`X-Kaufland-Scrape-Ingest-Secret`** + **`SCRAPE_CONTROL_HASH`**), normalizace polí `kaufland_kpi_scrape_*`; alias **`fetchScrapePlan()`**. **`postScrapeResult(payload)`** — POST na **`SCRAPE_API_BASE` + `/kaufland/scrape-ingest`** (stejná fixní hlavička + **`SCRAPE_INGEST_HASH`**). Volitelně **`SCRAPE_SETTINGS_URL`** / **`SCRAPE_INGEST_URL`** přepíšou výchozí URL z báze.

Modul **`src/lib/logger.js`**: `logRun` / `logError` → **`src/var/logs/run-YYYY-MM-DD.log`** a **`src/var/logs/error-YYYY-MM-DD.log`**. Při zápisu se občas spustí **`pruneOldLogs()`** (interval `LOG_PRUNE_INTERVAL_MS`, retence `LOG_RUN_RETENTION_DAYS` / `LOG_ERROR_RETENTION_DAYS`). Volitelně **logrotate**.

Job **`loginWithTotp`** na začátku volá `fetchScrapeSettings()`; při chybějící konfiguraci API vrací `null` a běží čistě podle `.env`. **`postScrapeResult`** lze doplnit po úspěchu runu (zatím dle vlastního cronu / serveru).

## Co se může pokazit (stručně)

| Riziko | Mitigace |
|--------|----------|
| Kaufland změní DOM / login | Selhání v `error.log`, alert z ingestu; verzovat worker |
| Session / TOTP / čas na Pi | NTP (`chrony`); při chybě smazat `storage-state.json` |
| Endpoint nedostupný | Timeout, retry s backoff v Laravelu nebo v cron wrapperu |
| Replay útoků na hash URL | Dlouhý secret, jen HTTPS, volitelně timestamp + HMAC v hlavičce |
| Disk plný logů | Denní soubory + retence ve `logger.js`; logrotate; `var/` sledovat |
| Příliš častý scrape | Řídit z Laravelu (`enabled`) + rozumný cron |

## Přihlašovací údaje: centralizace vs. .env

- **Vše z Laravelu** (GET vrátí i heslo/TOTP secret): jedna pravda, Pi `.env` bez citlivých dat — ale únik response nebo logu na serveru je kritický; endpoint musí být minimálně stejně chráněný jako DB.
- **Jen v .env na Pi** (dnešek): jednodušší, ale správa hesel na každé mašině.
- **Kompromis** („decentralizace“): např. **email / identita z API**, **heslo + TOTP jen v .env** — menší únik z API, pořád rozumný provoz.

Doporučení: **TOTP secret a heslo drž spíš mimo běžné GET JSON** (env na Pi, nebo Laravel šifrovaný sloupec + samostatný zabezpečený endpoint s krátkou životností tokenu). Pokud někdy pošleš heslo z API, **nikdy ho neloguj** a transport jen **HTTPS**.
