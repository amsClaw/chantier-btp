import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

async function serveur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-stock-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'stock.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}

async function api(url, chemin, method = 'GET', body) {
  const response = await fetch(url + chemin, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function contexte() {
  const instance = await serveur();
  const client = await api(instance.url, '/api/clients', 'POST', { nom: 'Client test' });
  const chantier = await api(instance.url, '/api/chantiers', 'POST', {
    client_id: client.json.id, nom: 'Chantier test',
  });
  return { instance, chantier: chantier.json };
}

test('les tables articles et mouvements_stock sont créées avec leurs contraintes', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());
  assert.deepEqual(instance.db.pragma('table_info(articles)').map((c) => c.name),
    ['id', 'nom', 'unite', 'seuil_alerte', 'created_at']);
  assert.deepEqual(instance.db.pragma('table_info(mouvements_stock)').map((c) => c.name),
    ['id', 'article_id', 'chantier_id', 'type', 'quantite', 'date_mouvement', 'motif', 'created_at', 'annule_par_id']);
  assert.equal(instance.db.pragma('foreign_key_list(mouvements_stock)').length, 3);
});

test('POST /api/articles crée un article et GET calcule un stock initial nul', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());
  const creation = await api(instance.url, '/api/articles', 'POST', {
    nom: 'Ciment', unite: 'sac', seuil_alerte: 10,
  });
  assert.equal(creation.status, 201);
  assert.equal(creation.json.stock_actuel, 0);
  const liste = await api(instance.url, '/api/articles');
  assert.deepEqual(liste.json.map(({ nom, unite, stock_actuel }) => ({ nom, unite, stock_actuel })),
    [{ nom: 'Ciment', unite: 'sac', stock_actuel: 0 }]);
});

test('POST /api/articles refuse les champs obligatoires invalides ou unité inconnue', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());
  assert.equal((await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment' })).status, 400);
  assert.equal((await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment', unite: 'inconnue' })).status, 400);
});

test('une entrée de 100 sacs porte le stock à 100', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());
  const article = await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment', unite: 'sac' });
  const mouvement = await api(instance.url, '/api/stock/mouvements', 'POST', {
    article_id: article.json.id, type: 'entree', quantite: 100, date_mouvement: '2026-09-25', motif: 'Approvisionnement',
  });
  assert.equal(mouvement.status, 201);
  assert.equal((await api(instance.url, '/api/articles')).json[0].stock_actuel, 100);
});

test('une sortie exige un chantier et diminue le stock', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const article = await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment', unite: 'sac' });
  await api(instance.url, '/api/stock/mouvements', 'POST', {
    article_id: article.json.id, type: 'entree', quantite: 100, date_mouvement: '2026-09-25',
  });
  const sortie = await api(instance.url, '/api/stock/mouvements', 'POST', {
    article_id: article.json.id, type: 'sortie', quantite: 30, chantier_id: chantier.id, date_mouvement: '2026-09-26', motif: 'Dalle',
  });
  assert.equal(sortie.status, 201);
  assert.equal((await api(instance.url, '/api/articles')).json[0].stock_actuel, 70);
  assert.equal((await api(instance.url, '/api/stock/mouvements', 'POST', {
    article_id: article.json.id, type: 'sortie', quantite: 1, date_mouvement: '2026-09-26',
  })).status, 400);
});

test('GET consommations détaille les sorties du chantier', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const article = await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment', unite: 'sac' });
  await api(instance.url, '/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'entree', quantite: 100, date_mouvement: '2026-09-25' });
  await api(instance.url, '/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'sortie', quantite: 30, chantier_id: chantier.id, date_mouvement: '2026-09-26' });
  const consommations = await api(instance.url, `/api/chantiers/${chantier.id}/consommations`);
  assert.equal(consommations.status, 200);
  assert.equal(consommations.json.length, 1);
  assert.equal(consommations.json[0].quantite, 30);
  assert.equal(consommations.json[0].article_nom, 'Ciment');
});

test('une sortie supérieure au stock est refusée et le stock reste inchangé', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const article = await api(instance.url, '/api/articles', 'POST', { nom: 'Ciment', unite: 'sac' });
  await api(instance.url, '/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'entree', quantite: 100, date_mouvement: '2026-09-25' });
  await api(instance.url, '/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'sortie', quantite: 30, chantier_id: chantier.id, date_mouvement: '2026-09-26' });
  const refus = await api(instance.url, '/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'sortie', quantite: 80, chantier_id: chantier.id, date_mouvement: '2026-09-27' });
  assert.equal(refus.status, 400);
  assert.equal(refus.json.error, 'Stock insuffisant');
  assert.equal(refus.json.stock_actuel, 70);
  assert.equal((await api(instance.url, '/api/articles')).json[0].stock_actuel, 70);
});
