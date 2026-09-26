import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

async function serveur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-caisse-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'caisse.sqlite') });
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

/** Serveur neuf + client + chantier, pour rattacher des opérations de caisse. */
async function contexte() {
  const instance = await serveur();
  const client = await api(instance.url, '/api/clients', 'POST', { nom: 'Société Immobilière Kaba' });
  const chantier = await api(instance.url, '/api/chantiers', 'POST', {
    client_id: client.json.id, nom: 'Résidence Palmeraie',
  });
  return { instance, chantier: chantier.json };
}

/** Raccourci : enregistre une transaction et renvoie la réponse HTTP. */
function enregistrer(instance, corps) {
  return api(instance.url, '/api/caisse/transactions', 'POST', corps);
}

function jourCourant() {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

test('la table transactions_caisse est créée avec ses colonnes et ses contraintes', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  assert.deepEqual(instance.db.pragma('table_info(transactions_caisse)').map((c) => c.name), [
    'id', 'type', 'montant', 'mode_paiement', 'categorie', 'motif', 'chantier_id',
    'date_transaction', 'created_at', 'annule_par_id',
  ]);

  const clesEtrangeres = instance.db.pragma('foreign_key_list(transactions_caisse)');
  assert.equal(clesEtrangeres.length, 2);
  assert.equal(clesEtrangeres.some((cle) => cle.table === 'chantiers' && cle.from === 'chantier_id' && cle.to === 'id'), true);

  // Les contraintes CHECK tiennent au niveau de la base, pas seulement des routes.
  const insertion = instance.db.prepare(`
    INSERT INTO transactions_caisse (type, montant, mode_paiement, categorie, motif, date_transaction, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const ligne = ['sortie', 1000, 'especes', 'divers', 'Test', '2026-09-25', Date.now()];
  assert.throws(() => insertion.run(...ligne.map((v, i) => (i === 1 ? 0 : v))), Error);
  assert.throws(() => insertion.run(...ligne.map((v, i) => (i === 1 ? -5000 : v))), Error);
  assert.throws(() => insertion.run(...ligne.map((v, i) => (i === 0 ? 'transfert' : v))), Error);
  assert.throws(() => insertion.run(...ligne.map((v, i) => (i === 2 ? 'crypto' : v))), Error);
  assert.equal(insertion.run(...ligne).changes, 1);
});

test('POST /api/caisse/transactions enregistre une entrée d\'espèces de 500 000', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const reponse = await enregistrer(instance, {
    type: 'entree', montant: 500000, mode_paiement: 'especes',
    categorie: 'apport_caisse', motif: 'Apport initial caisse', date_transaction: '2026-09-25',
  });

  assert.equal(reponse.status, 201);
  assert.equal(reponse.json.type, 'entree');
  assert.equal(reponse.json.montant, 500000);
  assert.equal(reponse.json.mode_paiement, 'especes');
  assert.equal(reponse.json.categorie, 'apport_caisse');
  assert.equal(reponse.json.motif, 'Apport initial caisse');
  assert.equal(reponse.json.chantier_id, null);
  assert.equal(reponse.json.date_transaction, '2026-09-25');
  assert.equal(typeof reponse.json.created_at, 'number');
});

test('POST /api/caisse/transactions enregistre une sortie Mobile Money de 150 000 rattachée à un chantier', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());

  const reponse = await enregistrer(instance, {
    type: 'sortie', montant: 150000, mode_paiement: 'mobile_money',
    categorie: 'main_d_oeuvre', motif: 'Paiement journalier tâcherons maçonnerie',
    chantier_id: chantier.id, date_transaction: '2026-09-26',
  });

  assert.equal(reponse.status, 201);
  assert.equal(reponse.json.type, 'sortie');
  assert.equal(reponse.json.montant, 150000);
  assert.equal(reponse.json.mode_paiement, 'mobile_money');
  assert.equal(reponse.json.chantier_id, chantier.id);
});

test('GET /api/caisse/solde renvoie exactement 350 000 après une entrée de 500 000 et une sortie de 150 000', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());

  await enregistrer(instance, {
    type: 'entree', montant: 500000, mode_paiement: 'especes',
    categorie: 'apport_caisse', motif: 'Apport initial caisse', date_transaction: '2026-09-25',
  });
  await enregistrer(instance, {
    type: 'sortie', montant: 150000, mode_paiement: 'mobile_money',
    categorie: 'main_d_oeuvre', motif: 'Tâcherons', chantier_id: chantier.id, date_transaction: '2026-09-26',
  });

  const solde = await api(instance.url, '/api/caisse/solde');
  assert.equal(solde.status, 200);
  assert.deepEqual(solde.json, { solde: 350000, total_entrees: 500000, total_sorties: 150000 });
  assert.equal(typeof solde.json.solde, 'number');
});

test('GET /api/caisse/solde sur une caisse vide renvoie des zéros numériques', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const solde = await api(instance.url, '/api/caisse/solde');
  assert.equal(solde.status, 200);
  assert.deepEqual(solde.json, { solde: 0, total_entrees: 0, total_sorties: 0 });
  assert.equal(typeof solde.json.total_entrees, 'number');
});

test('GET /api/caisse/transactions liste les opérations de la plus récente à la plus ancienne', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  // La dernière saisie porte la date la plus ancienne : le tri doit suivre la
  // date de l'opération, pas l'ordre d'insertion.
  await enregistrer(instance, { type: 'entree', montant: 100000, mode_paiement: 'especes', categorie: 'apport_caisse', motif: 'J-2', date_transaction: '2026-09-20' });
  await enregistrer(instance, { type: 'sortie', montant: 30000, mode_paiement: 'especes', categorie: 'carburant', motif: 'J', date_transaction: '2026-09-22' });
  await enregistrer(instance, { type: 'entree', montant: 20000, mode_paiement: 'virement', categorie: 'reglement_client', motif: 'J-3', date_transaction: '2026-09-19' });

  const journal = await api(instance.url, '/api/caisse/transactions');
  assert.equal(journal.status, 200);
  assert.deepEqual(journal.json.map(({ motif, date_transaction }) => ({ motif, date_transaction })), [
    { motif: 'J', date_transaction: '2026-09-22' },
    { motif: 'J-2', date_transaction: '2026-09-20' },
    { motif: 'J-3', date_transaction: '2026-09-19' },
  ]);
});

test('GET /api/caisse/transactions filtre sur ?chantier_id', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());

  await enregistrer(instance, { type: 'sortie', montant: 150000, mode_paiement: 'mobile_money', categorie: 'main_d_oeuvre', motif: 'Tâcherons', chantier_id: chantier.id, date_transaction: '2026-09-26' });
  await enregistrer(instance, { type: 'entree', montant: 500000, mode_paiement: 'especes', categorie: 'apport_caisse', motif: 'Apport caisse', date_transaction: '2026-09-25' });

  const complet = await api(instance.url, '/api/caisse/transactions');
  assert.equal(complet.json.length, 2);

  const filtre = await api(instance.url, `/api/caisse/transactions?chantier_id=${chantier.id}`);
  assert.equal(filtre.status, 200);
  assert.equal(filtre.json.length, 1);
  assert.equal(filtre.json[0].chantier_id, chantier.id);
  assert.equal(filtre.json[0].motif, 'Tâcherons');
});

test('GET /api/caisse/transactions sur un chantier sans opération renvoie une liste vide', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const filtre = await api(instance.url, '/api/caisse/transactions?chantier_id=99999');
  assert.equal(filtre.status, 200);
  assert.deepEqual(filtre.json, []);
});

test('GET /api/caisse/transactions refuse un ?chantier_id invalide', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  for (const valeur of ['abc', '0', '-1', '1.5']) {
    const reponse = await api(instance.url, `/api/caisse/transactions?chantier_id=${valeur}`);
    assert.equal(reponse.status, 400, `chantier_id=${valeur} devrait être refusé`);
  }
});

test('POST /api/caisse/transactions refuse un montant négatif, nul ou non entier', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const base = { type: 'sortie', mode_paiement: 'especes', categorie: 'divers', motif: 'Test' };
  for (const montant of [-50000, 0, 500.5, 'abc', null, undefined]) {
    const reponse = await enregistrer(instance, { ...base, montant });
    assert.equal(reponse.status, 400, `montant ${montant} devrait être refusé`);
  }
  const sansMontant = await enregistrer(instance, base);
  assert.equal(sansMontant.status, 400);

  // Rien n'a été écrit : le solde et le journal restent vides.
  assert.deepEqual((await api(instance.url, '/api/caisse/solde')).json,
    { solde: 0, total_entrees: 0, total_sorties: 0 });
  assert.deepEqual((await api(instance.url, '/api/caisse/transactions')).json, []);
});

test('POST /api/caisse/transactions refuse type, mode, catégorie, motif, chantier ou date invalides', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const valide = {
    type: 'sortie', montant: 100000, mode_paiement: 'especes',
    categorie: 'carburant', motif: 'Gasoil', date_transaction: '2026-09-25',
  };
  const refuses = [
    { ...valide, type: 'transfert' },
    { ...valide, type: '' },
    { ...valide, mode_paiement: 'crypto' },
    { ...valide, categorie: 'inconnue' },
    { ...valide, categorie: '' },
    { ...valide, motif: '   ' },
    { ...valide, motif: null },
    { ...valide, chantier_id: 99999 },
    { ...valide, chantier_id: 'abc' },
    { ...valide, date_transaction: '25/09/2026' },
  ];
  for (const corps of refuses) {
    const reponse = await enregistrer(instance, corps);
    assert.equal(reponse.status, 400, `corps ${JSON.stringify(corps)} devrait être refusé`);
    assert.equal(typeof reponse.json.error, 'string');
  }
  assert.equal((await api(instance.url, '/api/caisse/transactions')).json.length, 0);
});

test('POST /api/caisse/transactions sans date_transaction date l\'opération du jour', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());

  const reponse = await enregistrer(instance, {
    type: 'entree', montant: 25000, mode_paiement: 'cheque',
    categorie: 'reglement_client', motif: 'Acompte client',
  });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.json.date_transaction, jourCourant());
});

test('le solde reste exactement égal à total_entrees - total_sorties après plusieurs écritures', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());

  const operations = [
    { type: 'entree', montant: 3000000, mode_paiement: 'especes', categorie: 'apport_caisse', motif: 'Apport initial caisse' },
    { type: 'sortie', montant: 450000, mode_paiement: 'mobile_money', categorie: 'main_d_oeuvre', motif: 'Tâcherons', chantier_id: chantier.id },
    { type: 'sortie', montant: 120000, mode_paiement: 'especes', categorie: 'achat_materiaux', motif: 'Ciment' },
    { type: 'entree', montant: 1000000, mode_paiement: 'virement', categorie: 'reglement_client', motif: 'Acompte facture' },
  ];
  for (const operation of operations) {
    assert.equal((await enregistrer(instance, operation)).status, 201);
  }

  const solde = await api(instance.url, '/api/caisse/solde');
  assert.deepEqual(solde.json, { solde: 3430000, total_entrees: 4000000, total_sorties: 570000 });
  assert.equal(solde.json.solde, solde.json.total_entrees - solde.json.total_sorties);
  assert.equal((await api(instance.url, `/api/caisse/transactions?chantier_id=${chantier.id}`)).json.length, 1);
});
