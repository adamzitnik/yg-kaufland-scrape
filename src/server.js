import http from 'node:http';
import { config } from './config.js';
import { runPingPortal } from './jobs/pingPortal.js';
import { runLoginEmailPassword } from './jobs/loginEmailPassword.js';
import { runLoginWithTotp } from './jobs/loginWithTotp.js';

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Neplatný JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authorize(req) {
  if (!config.workerSecret) {
    return true;
  }
  return req.headers['x-worker-secret'] === config.workerSecret;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'kaufland-pi-worker' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/run') {
    if (!authorize(req)) {
      json(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { ok: false, error: 'Bad JSON body' });
      return;
    }
    const job = body.job ?? 'pingPortal';
    try {
      if (job === 'pingPortal') {
        const result = await runPingPortal();
        json(res, 200, { ok: true, result });
        return;
      }
      if (job === 'loginEmailPassword') {
        const result = await runLoginEmailPassword();
        json(res, 200, { ok: result.ok !== false, result });
        return;
      }
      if (job === 'loginWithTotp') {
        const result = await runLoginWithTotp();
        json(res, 200, { ok: result.ok !== false, result });
        return;
      }
      json(res, 400, { ok: false, error: `Unknown job: ${job}` });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(config.port, config.host, () => {
  console.log(
    `kaufland-pi-worker listening on http://${config.host}:${config.port}`,
  );
});
