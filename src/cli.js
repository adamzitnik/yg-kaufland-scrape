#!/usr/bin/env node
import { runPingPortal } from './jobs/pingPortal.js';
import { runLoginEmailPassword } from './jobs/loginEmailPassword.js';
import { runLoginWithTotp } from './jobs/loginWithTotp.js';

const job = process.argv[2] ?? 'ping';

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
    const out = await runLoginWithTotp();
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.error(
    'Neznámý job. Použití: node src/cli.js ping | node src/cli.js login | node src/cli.js login-totp',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
