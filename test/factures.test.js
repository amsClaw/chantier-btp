import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

async function contexte() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-factures-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'factures.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  const client = await requete(instance, '/api/clients', 'POST', { nom: 'Client Facturation' });
  const chantier = await requete(instance, '/api/chantiers', 'POST', {
    client_id: client.json.id, nom: 'Chantier Facturation', lieu: 'Conakry',
  });
  return { instance, chantier: chantier.json };
}

async function requete(instance, chemin, method = 'GET', corps) {
  const response = await fetch(instance.url + chemin, {
    method,
    headers: corps === undefined ? {} : { 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { status: response.status, json: await response.json() };
}

const lignes = [
  { designation: 'Fondations', quantite: 1, prix_unitaire: 600000 },
  { designation: 'Élévation', quantite: 2, prix_unitaire: 200000 },
];

test('le schéma de facturation expose les trois tables et les contraintes métier', async (t) => {
  const { instance } = await contexte();
  t.after(() => instance.close());
  assert.deepEqual(instance.db.pragma('table_info(factures)').map((colonne) => colonne.name), [
    'id', 'numero', 'chantier_id', 'date_emission', 'date_echeance', 'statut', 'created_at',
  ]);
  assert.deepEqual(instance.db.pragma('table_info(lignes_facture)').map((colonne) => colonne.name), [
    'id', 'facture_id', 'designation', 'quantite', 'prix_unitaire', 'total_ligne',
  ]);
  assert.deepEqual(instance.db.pragma('table_info(reglements_facture)').map((colonne) => colonne.name), [
    'id', 'facture_id', 'montant', 'mode_paiement', 'date_reglement', 'reference',
    'transaction_caisse_id', 'created_at',
  ]);
});

test('crée une facture séquentielle avec ses deux lignes et calcule le total', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const reponse = await requete(instance, '/api/factures', 'POST', {
    chantier_id: chantier.id, date_emission: '2026-09-25', date_echeance: '2026-10-25', lignes,
  });
  assert.equal(reponse.status, 201);
  assert.equal(reponse.json.numero, 'FAC-2026-0001');
  assert.equal(reponse.json.lignes.length, 2);
  assert.equal(reponse.json.montant_total, 1000000);
  assert.equal(reponse.json.montant_regle, 0);
  assert.equal(reponse.json.reste_a_payer, 1000000);
  assert.equal(reponse.json.statut, 'en_attente');

  const liste = await requete(instance, '/api/factures');
  assert.equal(liste.status, 200);
  assert.equal(liste.json[0].client_nom, 'Client Facturation');
  assert.equal(liste.json[0].montant_total, 1000000);
});

test('un acompte puis le solde alimentent la caisse et recalculent le statut', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const facture = await requete(instance, '/api/factures', 'POST', {
    chantier_id: chantier.id, date_emission: '2026-09-25', lignes,
  });
  const acompte = await requete(instance, `/api/factures/${facture.json.id}/reglements`, 'POST', {
    montant: 400000, mode_paiement: 'mobile_money', date_reglement: '2026-09-26', reference: 'AC-1',
  });
  assert.equal(acompte.status, 201);
  assert.equal(acompte.json.statut, 'partielle');
  assert.equal(acompte.json.montant_regle, 400000);
  assert.equal(acompte.json.reste_a_payer, 600000);
  assert.equal(acompte.json.reglements[0].transaction_caisse_id > 0, true);

  const caisse = await requete(instance, '/api/caisse/transactions');
  assert.equal(caisse.json.length, 1);
  assert.deepEqual(caisse.json[0], {
    id: caisse.json[0].id, type: 'entree', montant: 400000, mode_paiement: 'mobile_money',
    categorie: 'reglement_client', motif: 'Règlement Facture FAC-2026-0001 - Client Facturation',
    chantier_id: chantier.id, date_transaction: '2026-09-26', created_at: caisse.json[0].created_at, annule_par_id: null,
  });

  const solde = await requete(instance, `/api/factures/${facture.json.id}/reglements`, 'POST', {
    montant: 600000, mode_paiement: 'virement', date_reglement: '2026-10-01',
  });
  assert.equal(solde.status, 201);
  assert.equal(solde.json.statut, 'soldee');
  assert.equal(solde.json.reste_a_payer, 0);
  assert.equal(solde.json.reglements.length, 2);
});

test('rejette un règlement supérieur au reste à payer sans écrire dans la caisse', async (t) => {
  const { instance, chantier } = await contexte();
  t.after(() => instance.close());
  const facture = await requete(instance, '/api/factures', 'POST', {
    chantier_id: chantier.id, date_emission: '2026-09-25', lignes,
  });
  const reponse = await requete(instance, `/api/factures/${facture.json.id}/reglements`, 'POST', {
    montant: 1000001, mode_paiement: 'especes', date_reglement: '2026-09-26',
  });
  assert.equal(reponse.status, 400);
  assert.equal(reponse.json.error, 'Le montant dépasse le reste à payer');
  assert.deepEqual((await requete(instance, '/api/caisse/transactions')).json, []);
});
