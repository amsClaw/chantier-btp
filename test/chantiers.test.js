import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../src/server.js';

/**
 * Démarre un vrai serveur HTTP sur un port temporaire et une base SQLite dans
 * un répertoire temporaire : chaque test part d'une base vierge.
 */
async function demarrerServeur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-chantiers-'));
  const dbPath = path.join(dir, 'data', 'chantier.sqlite');
  const instance = startServer({ port: 0, dbPath });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}

/** Appel HTTP JSON : renvoie { status, json, texte }. */
async function api(url, chemin, { methode = 'GET', corps } = {}) {
  const res = await fetch(`${url}${chemin}`, {
    method: methode,
    headers: corps === undefined ? {} : { 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await res.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* réponse non JSON (404 par défaut d'Express, par exemple) */
  }
  return { status: res.status, json, texte };
}

/** Crée un client de test et renvoie son enregistrement. */
async function creerClient(url, corps = { nom: 'Société Immobilière Kaba' }) {
  const { status, json } = await api(url, '/api/clients', { methode: 'POST', corps });
  assert.equal(status, 201, `création du client attendue en 201, reçue ${status}`);
  return json;
}

/** Crée un chantier de test rattaché à `clientId`. */
async function creerChantier(url, clientId, corps = {}) {
  return api(url, '/api/chantiers', {
    methode: 'POST',
    corps: { client_id: clientId, nom: 'Résidence Palmeraie', lieu: 'Conakry', ...corps },
  });
}

test('les tables clients et chantiers sont créées au démarrage, conformes au schéma', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());

  const colonnes = (table) =>
    instance.db.pragma(`table_info(${table})`).map((c) => [c.name, c.type, c.notnull > 0, c.pk > 0]);

  assert.deepEqual(colonnes('clients'), [
    ['id', 'INTEGER', false, true],
    ['nom', 'TEXT', true, false],
    ['telephone', 'TEXT', false, false],
    ['adresse', 'TEXT', false, false],
    ['created_at', 'INTEGER', true, false],
  ]);
  assert.deepEqual(colonnes('chantiers'), [
    ['id', 'INTEGER', false, true],
    ['client_id', 'INTEGER', true, false],
    ['nom', 'TEXT', true, false],
    ['lieu', 'TEXT', false, false],
    ['statut', 'TEXT', false, false],
    ['date_debut', 'TEXT', false, false],
    ['created_at', 'INTEGER', true, false],
  ]);

  // Valeur par défaut du statut et clé étrangère vers clients.
  const statut = instance.db.pragma('table_info(chantiers)').find((c) => c.name === 'statut');
  assert.equal(statut.dflt_value, "'en_cours'");
  const fk = instance.db.pragma('foreign_key_list(chantiers)');
  assert.equal(fk.length, 1);
  assert.equal(fk[0].table, 'clients');
  assert.equal(fk[0].from, 'client_id');
  assert.equal(fk[0].to, 'id');
  assert.equal(instance.db.pragma('foreign_keys', { simple: true }), 1);
});

test('POST /api/clients crée un client, GET /api/clients le retourne', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url, {
    nom: 'Société Immobilière Kaba',
    telephone: '+224 620 00 00 00',
    adresse: 'Kaloum, Conakry',
  });

  assert.ok(client.id > 0);
  assert.equal(client.nom, 'Société Immobilière Kaba');
  assert.equal(client.telephone, '+224 620 00 00 00');
  assert.equal(client.adresse, 'Kaloum, Conakry');
  assert.ok(Number.isInteger(client.created_at) && client.created_at > 0);

  const liste = await api(url, '/api/clients');
  assert.equal(liste.status, 200);
  assert.equal(liste.json.length, 1);
  assert.deepEqual(liste.json[0], client);

  // Champs facultatifs omis : NULL en base, pas de plantage.
  const minimal = await creerClient(url, { nom: 'Mamadou Diallo' });
  assert.equal(minimal.telephone, null);
  assert.equal(minimal.adresse, null);
});

test('POST /api/clients sans nom (ou nom vide) renvoie 400', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const sansNom = await api(url, '/api/clients', { methode: 'POST', corps: { telephone: '620' } });
  assert.equal(sansNom.status, 400);
  assert.match(sansNom.json.error, /nom/);

  const nomVide = await api(url, '/api/clients', { methode: 'POST', corps: { nom: '   ' } });
  assert.equal(nomVide.status, 400);

  // Aucun client fantôme n'a été créé.
  const liste = await api(url, '/api/clients');
  assert.deepEqual(liste.json, []);
});

test('POST /api/chantiers rattache un chantier à un client existant', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url);
  const creation = await creerChantier(url, client.id, {
    nom: 'Résidence Palmeraie',
    lieu: 'Ratoma, Conakry',
    date_debut: '2026-10-01',
  });

  assert.equal(creation.status, 201);
  const chantier = creation.json;
  assert.equal(chantier.client_id, client.id);
  assert.equal(chantier.nom, 'Résidence Palmeraie');
  assert.equal(chantier.lieu, 'Ratoma, Conakry');
  assert.equal(chantier.date_debut, '2026-10-01');
  assert.equal(chantier.statut, 'en_cours', 'statut par défaut en_cours');
  assert.equal(chantier.client_nom, 'Société Immobilière Kaba');

  const liste = await api(url, '/api/chantiers');
  assert.equal(liste.status, 200);
  assert.equal(liste.json.length, 1);
  assert.equal(liste.json[0].client_nom, 'Société Immobilière Kaba');
  assert.equal(liste.json[0].statut, 'en_cours');
});

test('POST /api/chantiers : 400 si client_id ou nom manquant', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;
  const client = await creerClient(url);

  const sansClient = await api(url, '/api/chantiers', { methode: 'POST', corps: { nom: 'Villa' } });
  assert.equal(sansClient.status, 400);
  assert.match(sansClient.json.error, /client_id/);

  const sansNom = await api(url, '/api/chantiers', { methode: 'POST', corps: { client_id: client.id } });
  assert.equal(sansNom.status, 400);
  assert.match(sansNom.json.error, /nom/);

  const videEnCorps = await api(url, '/api/chantiers', { methode: 'POST' });
  assert.equal(videEnCorps.status, 400);
  assert.match(videEnCorps.json.error, /client_id/);

  const liste = await api(url, '/api/chantiers');
  assert.deepEqual(liste.json, []);
});

test('POST /api/chantiers : 400 si le client_id n\'existe pas ou si le statut est inconnu', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;
  const client = await creerClient(url);

  const clientInconnu = await creerChantier(url, 9999);
  assert.equal(clientInconnu.status, 400);
  assert.match(clientInconnu.json.error, /client/i);

  const statutInconnu = await creerChantier(url, client.id, { statut: 'abandonne' });
  assert.equal(statutInconnu.status, 400);
  assert.match(statutInconnu.json.error, /statut/);

  const dateInvalide = await creerChantier(url, client.id, { date_debut: '01/10/2026' });
  assert.equal(dateInvalide.status, 400);

  const liste = await api(url, '/api/chantiers');
  assert.deepEqual(liste.json, []);
});

test('GET /api/chantiers/:id renvoie le détail du chantier avec les données du client', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url, {
    nom: 'Société Immobilière Kaba',
    telephone: '620000000',
    adresse: 'Kaloum',
  });
  const { json: chantier } = await creerChantier(url, client.id);

  const detail = await api(url, `/api/chantiers/${chantier.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.id, chantier.id);
  assert.equal(detail.json.client_nom, 'Société Immobilière Kaba');
  assert.deepEqual(detail.json.client, client);
});

test('GET /api/chantiers/:id inconnu renvoie 404 sans arrêter le serveur', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  for (const identifiant of ['99999', 'abc', '0']) {
    const res = await api(url, `/api/chantiers/${identifiant}`);
    assert.equal(res.status, 404, `identifiant ${identifiant} attendu en 404`);
    assert.ok(res.json?.error, 'la réponse 404 est un JSON { error }');
  }

  const sante = await api(url, '/health');
  assert.equal(sante.status, 200);
  assert.deepEqual(sante.json, { status: 'ok' });
});

test('GET /api/chantiers?statut= filtre les chantiers en cours et terminés', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url);
  const enCours = (await creerChantier(url, client.id, { nom: 'Chantier en cours' })).json;
  const aCloturer = (await creerChantier(url, client.id, { nom: 'Chantier terminé' })).json;
  await api(url, `/api/chantiers/${aCloturer.id}`, { methode: 'PATCH', corps: { statut: 'termine' } });

  const tous = await api(url, '/api/chantiers');
  assert.equal(tous.json.length, 2);

  const filtres = await api(url, '/api/chantiers?statut=en_cours');
  assert.equal(filtres.status, 200);
  assert.deepEqual(
    filtres.json.map((c) => c.nom),
    ['Chantier en cours'],
  );
  assert.equal(filtres.json[0].id, enCours.id);

  const termines = await api(url, '/api/chantiers?statut=termine');
  assert.deepEqual(
    termines.json.map((c) => c.nom),
    ['Chantier terminé'],
  );

  const statutInconnu = await api(url, '/api/chantiers?statut=abandonne');
  assert.equal(statutInconnu.status, 400);
  assert.match(statutInconnu.json.error, /statut/);
});

test('PATCH /api/chantiers/:id clôture un chantier (statut termine) et le persiste', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url);
  const { json: chantier } = await creerChantier(url, client.id);

  const cloture = await api(url, `/api/chantiers/${chantier.id}`, {
    methode: 'PATCH',
    corps: { statut: 'termine' },
  });
  assert.equal(cloture.status, 200);
  assert.equal(cloture.json.statut, 'termine');
  assert.equal(cloture.json.nom, 'Résidence Palmeraie', 'les autres champs sont conservés');

  // Persistance réelle en base, pas seulement dans la réponse HTTP.
  const enBase = instance.db.prepare('SELECT statut FROM chantiers WHERE id = ?').get(chantier.id);
  assert.deepEqual(enBase, { statut: 'termine' });

  const relu = await api(url, `/api/chantiers/${chantier.id}`);
  assert.equal(relu.json.statut, 'termine');

  // La clôture ne supprime aucune donnée (hypothèse H6 de la SPEC).
  const liste = await api(url, '/api/chantiers');
  assert.equal(liste.json.length, 1);
});

test('PATCH /api/chantiers/:id met à jour les détails (nom, lieu, date_debut)', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url);
  const { json: chantier } = await creerChantier(url, client.id, { lieu: null, date_debut: null });

  const maj = await api(url, `/api/chantiers/${chantier.id}`, {
    methode: 'PATCH',
    corps: { nom: 'Résidence Palmeraie phase 2', lieu: 'Kipé', date_debut: '2026-11-05' },
  });
  assert.equal(maj.status, 200);
  assert.equal(maj.json.nom, 'Résidence Palmeraie phase 2');
  assert.equal(maj.json.lieu, 'Kipé');
  assert.equal(maj.json.date_debut, '2026-11-05');
  assert.equal(maj.json.statut, 'en_cours');

  // Le client rattaché n'est pas modifiable par ce PATCH et reste inchangé.
  assert.equal(maj.json.client_id, client.id);
});

test('PATCH /api/chantiers/:id : 400 sur saisie invalide, 404 sur identifiant inconnu', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const client = await creerClient(url);
  const { json: chantier } = await creerChantier(url, client.id);

  const statutInvalide = await api(url, `/api/chantiers/${chantier.id}`, {
    methode: 'PATCH',
    corps: { statut: 'abandonne' },
  });
  assert.equal(statutInvalide.status, 400);

  const nomVide = await api(url, `/api/chantiers/${chantier.id}`, {
    methode: 'PATCH',
    corps: { nom: '' },
  });
  assert.equal(nomVide.status, 400);

  const corpsVide = await api(url, `/api/chantiers/${chantier.id}`, {
    methode: 'PATCH',
    corps: {},
  });
  assert.equal(corpsVide.status, 400);

  const inconnu = await api(url, '/api/chantiers/99999', {
    methode: 'PATCH',
    corps: { statut: 'termine' },
  });
  assert.equal(inconnu.status, 404);

  // Aucune modification n'a été appliquée par les requêtes refusées.
  const relu = await api(url, `/api/chantiers/${chantier.id}`);
  assert.equal(relu.json.statut, 'en_cours');
  assert.equal(relu.json.nom, 'Résidence Palmeraie');
});

test('un corps JSON malformé renvoie 400 et le serveur reste opérationnel', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;

  const res = await fetch(`${url}/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ "nom": ',
  });
  assert.equal(res.status, 400);

  const sante = await api(url, '/health');
  assert.equal(sante.status, 200);

  const creation = await creerClient(url, { nom: 'Après erreur' });
  assert.equal(creation.nom, 'Après erreur');
});
