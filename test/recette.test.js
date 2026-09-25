import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../src/server.js';

/**
 * Recette des scénarios holdout de docs/SPEC.md, jouée contre le vrai serveur.
 *
 * Ces trois scénarios ont été écrits pour être exécutés par un tiers, sans lire le
 * code : ce fichier les rejoue pas à pas et fixe les valeurs exactes attendues
 * (stocks, solde de caisse, reste à payer). Les résultats observés alimentent le
 * tableau de recette du README.
 */

/** Serveur réel sur un port libre et une base temporaire. */
async function demarrer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-recette-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'data', 'chantier.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}

/** Client HTTP minimal renvoyant `{ statut, corps }`, comme le fait l'interface. */
function client(url) {
  return async (chemin, corps, methode = 'POST') => {
    const reponse = await fetch(`${url}${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    return { statut: reponse.status, corps: await reponse.json().catch(() => null) };
  };
}

const lire = async (url, chemin) => (await fetch(`${url}${chemin}`)).json();

/**
 * Holdout 1, étapes 1 à 6 : client, chantier, approvisionnements, consommations,
 * caisse, facture et acompte. Renvoie les identifiants utiles aux vérifications.
 */
async function mettreEnPlaceHoldout1(envoyer) {
  const kaba = await envoyer('/api/clients', { nom: 'Société Immobilière Kaba' });
  const chantier = await envoyer('/api/chantiers', {
    client_id: kaba.corps.id,
    nom: 'Résidence Palmeraie',
    lieu: 'Ratoma, Conakry',
    date_debut: '2026-09-01',
    statut: 'en_cours',
  });
  const ciment = await envoyer('/api/articles', { nom: 'Ciment', unite: 'sac', seuil_alerte: 50 });
  const fer = await envoyer('/api/articles', { nom: 'Fer à béton 12 mm', unite: 'barre', seuil_alerte: 30 });

  await envoyer('/api/stock/mouvements', {
    article_id: ciment.corps.id, type: 'entree', quantite: 200, date_mouvement: '2026-09-02', motif: 'Livraison dépôt',
  });
  await envoyer('/api/stock/mouvements', {
    article_id: fer.corps.id, type: 'entree', quantite: 100, date_mouvement: '2026-09-02', motif: 'Livraison dépôt',
  });
  await envoyer('/api/stock/mouvements', {
    article_id: ciment.corps.id, type: 'sortie', quantite: 80,
    chantier_id: chantier.corps.id, date_mouvement: '2026-09-04', motif: 'Fondations',
  });
  await envoyer('/api/stock/mouvements', {
    article_id: fer.corps.id, type: 'sortie', quantite: 40,
    chantier_id: chantier.corps.id, date_mouvement: '2026-09-04', motif: 'Armatures',
  });

  await envoyer('/api/caisse/transactions', {
    type: 'entree', montant: 3000000, mode_paiement: 'especes', categorie: 'apport_caisse',
    motif: 'Apport initial caisse', date_transaction: '2026-09-01',
  });
  await envoyer('/api/caisse/transactions', {
    type: 'sortie', montant: 450000, mode_paiement: 'mobile_money', categorie: 'main_d_oeuvre',
    motif: 'Paiement journalier tâcherons maçonnerie', chantier_id: chantier.corps.id, date_transaction: '2026-09-05',
  });

  const facture = await envoyer('/api/factures', {
    chantier_id: chantier.corps.id,
    date_emission: '2026-09-10',
    date_echeance: '2026-10-10',
    lignes: [{ designation: 'Fondations et élévation gros œuvre', quantite: 1, prix_unitaire: 2500000 }],
  });
  const acompte = await envoyer(`/api/factures/${facture.corps.id}/reglements`, {
    montant: 1000000, mode_paiement: 'virement', date_reglement: '2026-09-15', reference: 'Virement BDMG 118',
  });

  return { chantier: chantier.corps, ciment: ciment.corps, fer: fer.corps, facture: facture.corps, acompte };
}

/* --- Holdout 1 ------------------------------------------------------------- */
test('holdout 1 — cycle complet : stock 120/60, solde 3 550 000, facture partielle', async (t) => {
  const instance = await demarrer();
  t.after(() => instance.close());
  const envoyer = client(instance.url);

  const { chantier, facture, acompte } = await mettreEnPlaceHoldout1(envoyer);

  // Stock restant : 200 − 80 = 120 sacs, 100 − 40 = 60 barres.
  const articles = await lire(instance.url, '/api/articles');
  assert.deepEqual(articles.map((article) => [article.nom, article.stock_actuel]), [
    ['Ciment', 120],
    ['Fer à béton 12 mm', 60],
  ]);

  // Fiche chantier : le détail des consommations est bien rattaché au chantier.
  const consommations = await lire(instance.url, `/api/chantiers/${chantier.id}/consommations`);
  assert.deepEqual(consommations.map((mouvement) => [mouvement.article_nom, mouvement.quantite]), [
    ['Ciment', 80],
    ['Fer à béton 12 mm', 40],
  ]);

  // Caisse : 3 000 000 − 450 000 + 1 000 000 (règlement) = 3 550 000.
  const solde = await lire(instance.url, '/api/caisse/solde');
  assert.deepEqual(solde, { solde: 3550000, total_entrees: 4000000, total_sorties: 450000 });

  // Facture : 2 500 000 émis, 1 000 000 réglé, reste 1 500 000, statut partielle.
  const detail = await lire(instance.url, `/api/factures/${facture.id}`);
  assert.equal(detail.montant_total, 2500000);
  assert.equal(detail.montant_regle, 1000000);
  assert.equal(detail.reste_a_payer, 1500000);
  assert.equal(detail.statut, 'partielle');
  assert.equal(acompte.statut, 201);

  // Le règlement a alimenté le journal de caisse sans double saisie.
  const journal = await lire(instance.url, '/api/caisse/transactions');
  const ligneAuto = journal.filter((operation) => operation.categorie === 'reglement_client');
  assert.equal(ligneAuto.length, 1);
  assert.equal(ligneAuto[0].montant, 1000000);
  assert.equal(ligneAuto[0].type, 'entree');
  assert.match(ligneAuto[0].motif, /^Règlement Facture FAC-\d{4}-\d{4} - Société Immobilière Kaba$/);
});

/* --- Holdout 2 ------------------------------------------------------------- */
test('holdout 2 — les données survivent à un redémarrage avec le même DB_PATH', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-recette-2-'));
  const dbPath = path.join(dir, 'data', 'chantier.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const premier = startServer({ port: 0, dbPath });
  if (!premier.server.listening) await once(premier.server, 'listening');
  const envoyer = client(premier.url);
  const { chantier, facture } = await mettreEnPlaceHoldout1(envoyer);
  const soldeAvant = await lire(premier.url, '/api/caisse/solde');

  // Arrêt du serveur, comme un `kill` sur le processus Node.js.
  await premier.close();

  const second = startServer({ port: 0, dbPath });
  if (!second.server.listening) await once(second.server, 'listening');
  t.after(() => second.close());

  assert.deepEqual(await lire(second.url, '/api/caisse/solde'), soldeAvant);
  assert.equal((await lire(second.url, `/api/factures/${facture.id}`)).reste_a_payer, 1500000);
  assert.equal((await lire(second.url, `/api/chantiers/${chantier.id}/consommations`)).length, 2);
  assert.equal((await lire(second.url, '/api/clients')).length, 1);
  assert.equal((await lire(second.url, '/api/articles')).length, 2);
});

/* --- Holdout 3 ------------------------------------------------------------- */
test('holdout 3 — refus des cas limites et service toujours disponible', async (t) => {
  const instance = await demarrer();
  t.after(() => instance.close());
  const envoyer = client(instance.url);

  const { chantier, ciment, facture } = await mettreEnPlaceHoldout1(envoyer);

  // 1. Sortie de 500 sacs alors que 120 sont disponibles : refusée, stock intact.
  const excedent = await envoyer('/api/stock/mouvements', {
    article_id: ciment.id, type: 'sortie', quantite: 500,
    chantier_id: chantier.id, date_mouvement: '2026-09-20', motif: 'Tentative de sortie excédentaire',
  });
  assert.equal(excedent.statut, 400);
  assert.equal(excedent.corps.error, 'Stock insuffisant');
  assert.equal(excedent.corps.stock_actuel, 120);
  const apresRefus = await lire(instance.url, '/api/articles');
  assert.equal(apresRefus.find((article) => article.id === ciment.id).stock_actuel, 120);

  // 2. Montants de caisse négatif et nul : 400 dans les deux cas.
  for (const montant of [-50000, 0]) {
    const refus = await envoyer('/api/caisse/transactions', {
      type: 'entree', montant, mode_paiement: 'especes', categorie: 'divers', motif: 'Montant invalide',
    });
    assert.equal(refus.statut, 400, `montant ${montant} refusé attendu`);
    assert.match(refus.corps.error, /montant/i);
  }

  // 3. Surpaiement d'une facture : 2 000 000 demandés pour 1 500 000 dus.
  const surpaiement = await envoyer(`/api/factures/${facture.id}/reglements`, {
    montant: 2000000, mode_paiement: 'especes', date_reglement: '2026-09-25',
  });
  assert.equal(surpaiement.statut, 400);
  assert.equal(surpaiement.corps.error, 'Le montant dépasse le reste à payer');
  assert.equal((await lire(instance.url, `/api/factures/${facture.id}`)).reste_a_payer, 1500000);

  // 4. Identifiants inexistants : 404 propre, puis /health répond toujours 200.
  for (const inconnu of ['/api/chantiers/99999', '/api/factures/99999']) {
    const reponse = await fetch(`${instance.url}${inconnu}`);
    assert.equal(reponse.status, 404, `${inconnu} devait répondre 404`);
  }
  const sante = await fetch(`${instance.url}/health`);
  assert.equal(sante.status, 200);
  assert.deepEqual(await sante.json(), { status: 'ok' });
});
