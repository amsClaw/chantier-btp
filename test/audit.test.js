import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

async function contexte() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-audit-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'audit.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  const appel = (chemin, method = 'GET', body) => fetch(instance.url + chemin, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, json: await response.json() }));
  const client = await appel('/api/clients', 'POST', { nom: 'Audit' });
  const chantier = await appel('/api/chantiers', 'POST', { client_id: client.json.id, nom: 'Audit chantier' });
  return { instance, appel, chantier: chantier.json };
}

const factureCorps = (chantierId) => ({ chantier_id: chantierId, date_emission: '2026-09-25', lignes: [{ designation: 'Main d’œuvre', quantite: 2, prix_unitaire: 100 }] });

test('annulation stock crée une compensation, conserve l original et refuse la double annulation', async (t) => {
  const { instance, appel, chantier } = await contexte(); t.after(() => instance.close());
  const article = await appel('/api/articles', 'POST', { nom: 'Ciment', unite: 'sac' });
  const mouvement = await appel('/api/stock/mouvements', 'POST', { article_id: article.json.id, type: 'entree', quantite: 10, date_mouvement: '2026-09-25', chantier_id: chantier.id });
  assert.equal((await appel(`/api/stock/mouvements/${mouvement.json.id}/annuler`, 'POST', { motif: 'Erreur de saisie' })).status, 201);
  assert.equal((await appel(`/api/stock/mouvements/${mouvement.json.id}/annuler`, 'POST', { motif: 'Encore' })).status, 400);
  const historique = await appel(`/api/historique/stock/${mouvement.json.id}`);
  assert.equal(historique.json.length, 1); assert.equal(historique.json[0].motif, 'Erreur de saisie');
  assert.equal((await appel('/api/articles')).json[0].stock_actuel, 0);
});

test('annulation caisse est auditée et les règlements de facture sont protégés', async (t) => {
  const { instance, appel, chantier } = await contexte(); t.after(() => instance.close());
  const operation = await appel('/api/caisse/transactions', 'POST', { type: 'sortie', montant: 50, mode_paiement: 'especes', categorie: 'divers', motif: 'Erreur', chantier_id: chantier.id });
  assert.equal((await appel(`/api/caisse/transactions/${operation.json.id}/annuler`, 'POST', { motif: 'Correction caisse' })).status, 201);
  const facture = await appel('/api/factures', 'POST', factureCorps(chantier.id));
  const reglement = await appel(`/api/factures/${facture.json.id}/reglements`, 'POST', { montant: 50, mode_paiement: 'especes' });
  const caisse = await appel(`/api/caisse/transactions/${reglement.json.reglements[0].transaction_caisse_id}/annuler`, 'POST', { motif: 'Refus' });
  assert.equal(caisse.status, 400); assert.match(caisse.json.error, /règlement de facture/);
});

test('correction de ligne non réglée recalcule le total et est bloquée après règlement', async (t) => {
  const { instance, appel, chantier } = await contexte(); t.after(() => instance.close());
  const facture = await appel('/api/factures', 'POST', factureCorps(chantier.id));
  const ligneId = facture.json.lignes[0].id;
  const corrigee = await appel(`/api/factures/${facture.json.id}/lignes/${ligneId}`, 'PATCH', { quantite: 3, prix_unitaire: 150, motif: 'Prix corrigé' });
  assert.equal(corrigee.status, 200); assert.equal(corrigee.json.montant_total, 450);
  assert.equal((await appel(`/api/historique/facture/${ligneId}`)).json.length, 1);
  await appel(`/api/factures/${facture.json.id}/reglements`, 'POST', { montant: 50, mode_paiement: 'especes' });
  const refusee = await appel(`/api/factures/${facture.json.id}/lignes/${ligneId}`, 'PATCH', { prix_unitaire: 1, motif: 'Trop tard' });
  assert.equal(refusee.status, 409);
});
