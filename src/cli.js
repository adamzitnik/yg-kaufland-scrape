#!/usr/bin/env node
import { runPingPortal } from './jobs/pingPortal.js';
import { runLoginEmailPassword } from './jobs/loginEmailPassword.js';
import { runLoginWithTotp } from './jobs/loginWithTotp.js';
import { runWarehouseDashboard } from './jobs/warehouseDashboard.js';
import { config } from './config.js';
import { logError } from './lib/logger.js';

const job = process.argv[2] ?? 'ping';

async function maybeRunWarehouseAfterKaufland(kauflandResult) {
  if (!config.warehouseScrapeAfterKaufland) {
    return null;
  }
  if (!config.warehouseScrapeEnabled) {
    return null;
  }
  // I při skipped Kaufland (disabled) Warehouse může běžet samostatně —
  // spouštíme vždy po dokončení kaufland jobu (úspěch i skip).
  console.log('\n[cli] Spouštím Warehouse scrape po Kauflandu…\n');
  try {
    return await runWarehouseDashboard();
  } catch (e) {
    logError('warehouse after kaufland', e);
    return {
      job: 'warehouseDashboard',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  if (job === 'ping' || job === 'pingPortal') {
    const out = await runPingPortal();
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (job === 'login' || job === 'loginEmailPassword') {
    const out = await runLoginEmailPassword();
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (job === 'login-totp' || job === 'loginWithTotp') {
    const kaufland = await runLoginWithTotp();
    const warehouse = await maybeRunWarehouseAfterKaufland(kaufland);
    if (warehouse) {
      console.log(
        JSON.stringify({ kaufland, warehouse }, null, 2),
      );
    } else {
      console.log(JSON.stringify(kaufland, null, 2));
    }
    return;
  }
  if (job === 'warehouse' || job === 'warehouseDashboard') {
    const out = await runWarehouseDashboard();
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.error(
    'Neznámý job. Použití: node src/cli.js ping | login | login-totp | warehouse',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
