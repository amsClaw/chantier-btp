import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../src/server.js';

/**
 * Démarre un serveur réel sur un port temporaire (port 0 : attribué par l'OS)
 * et une base SQLite dans un répertoire temporaire, pour ne jamais toucher au
 * `./data/` du dépôt.
 */
async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-test-'));
  const dbPath = path.join(dir, 'data', 'chantier.sqlite');
  const instance = startServer({ port: 0, dbPath });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return { dir, dbPath, instance };
}

test('GET /health répond 200 avec le payload { "status": "ok" }', async (t) => {
  const { instance } = await startTestServer();
  t.after(() => instance.close());

  const res = await fetch(`${instance.url}/health`);

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('le serveur écoute bien sur un port TCP réel', async (t) => {
  const { instance } = await startTestServer();
  t.after(() => instance.close());

  assert.equal(typeof instance.port, 'number');
  assert.ok(instance.port > 0);
  assert.match(instance.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('une route inconnue répond 404 (le squelette n\'expose que /health)', async (t) => {
  const { instance } = await startTestServer();
  t.after(() => instance.close());

  const res = await fetch(`${instance.url}/api/inconnu`);

  assert.equal(res.status, 404);
});

test('la base SQLite est créée au démarrage, répertoire parent compris', async (t) => {
  const { dbPath, instance } = await startTestServer();
  t.after(() => instance.close());

  assert.ok(fs.existsSync(dbPath), `base attendue au chemin ${dbPath}`);
  assert.ok(fs.statSync(dbPath).isFile());
  // Répertoire parent créé récursivement : il n'existait pas avant le démarrage.
  assert.ok(fs.statSync(path.dirname(dbPath)).isDirectory());
});
