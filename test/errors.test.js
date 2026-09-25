import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { gestionnaireErreurs } from '../src/app.js';
import { startServer } from '../src/server.js';

/** Serveur réel de l'application (port 0 + base temporaire). */
async function demarrerApplication() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-erreurs-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'data', 'chantier.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}

/** Application minimale : deux routes fautives + un /health, pour isoler le middleware. */
async function demarrerApplicationFautive(t) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/exception', () => {
    throw new Error('détail interne qui ne doit pas fuir');
  });
  app.get('/refus', (_req, _res, next) => {
    next(Object.assign(new Error('Montant invalide'), { status: 400 }));
  });
  app.use(gestionnaireErreurs);

  const serveur = app.listen(0);
  await once(serveur, 'listening');
  t.after(() => serveur.close());

  // Le journal d'erreurs reste dans la console du serveur, pas dans la sortie des tests.
  const journal = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = journal;
  });

  return `http://127.0.0.1:${serveur.address().port}`;
}

/* --- Le middleware lui-même ------------------------------------------------ */
test('une exception inattendue devient un 500 JSON générique, sans arrêter le serveur', async (t) => {
  const url = await demarrerApplicationFautive(t);

  const res = await fetch(`${url}/exception`);
  const corps = await res.json();

  assert.equal(res.status, 500);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(corps, { error: 'Erreur interne du serveur' });
  // Le message technique n'est jamais renvoyé au client.
  assert.doesNotMatch(JSON.stringify(corps), /détail interne/);
  // Le service est toujours debout juste après.
  assert.equal((await fetch(`${url}/health`)).status, 200);
});

test('une erreur portant un statut (400) conserve son code et son message', async (t) => {
  const url = await demarrerApplicationFautive(t);

  const res = await fetch(`${url}/refus`);

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Montant invalide' });
});

/* --- Robustesse de la vraie application ------------------------------------ */
test('un corps JSON malformé répond 400 en JSON et GET /health reste à 200', async (t) => {
  const instance = await demarrerApplication();
  t.after(() => instance.close());

  const journal = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = journal;
  });

  const res = await fetch(`${instance.url}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ "nom": ',
  });

  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const corps = await res.json();
  assert.ok(corps.error, 'une erreur explicite est attendue');

  const sante = await fetch(`${instance.url}/health`);
  assert.equal(sante.status, 200);
  assert.deepEqual(await sante.json(), { status: 'ok' });
});

test('une route API inconnue répond 404 en JSON, pas en HTML', async (t) => {
  const instance = await demarrerApplication();
  t.after(() => instance.close());

  const res = await fetch(`${instance.url}/api/inconnu`);

  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Route API inconnue' });
});

test('des saisies invalides en série ne font jamais tomber le serveur', async (t) => {
  const instance = await demarrerApplication();
  t.after(() => instance.close());

  const envoyer = (chemin, corps, methode = 'POST') => fetch(`${instance.url}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: typeof corps === 'string' ? corps : JSON.stringify(corps),
  });

  const reponses = [
    await envoyer('/api/clients', { nom: '' }),
    await envoyer('/api/caisse/transactions', { type: 'nimporte', montant: -1 }),
    await envoyer('/api/stock/mouvements', { article_id: 'abc', quantite: 0 }),
    await envoyer(`/api/chantiers/${'9'.repeat(30)}`, null, 'PATCH'),
    await envoyer('/api/factures', 'pas du json du tout'),
  ];

  for (const reponse of reponses) {
    assert.ok(reponse.status >= 400 && reponse.status < 500, `statut inattendu ${reponse.status}`);
    assert.equal((await reponse.json()).error !== undefined, true, 'une erreur JSON est attendue');
  }

  assert.equal((await fetch(`${instance.url}/health`)).status, 200);
});
