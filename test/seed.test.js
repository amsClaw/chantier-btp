import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { openDatabase } from '../src/db.js';

const executer = promisify(execFile);
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Lance `npm run seed` dans un répertoire temporaire, sur le fichier SQLite demandé. */
async function lancerSeed(dbPath) {
  const { stdout } = await executer(process.execPath, ['scripts/seed.js'], {
    cwd: RACINE,
    env: { ...process.env, DB_PATH: dbPath },
    timeout: 60000,
  });
  return stdout;
}

/** Ouvre la base produite par le seed et renvoie les compteurs observés. */
function compter(dbPath) {
  const db = openDatabase(dbPath);
  try {
    const un = (sql) => db.prepare(sql).get().valeur;
    return {
      clients: un('SELECT COUNT(*) AS valeur FROM clients'),
      chantiers: un('SELECT COUNT(*) AS valeur FROM chantiers'),
      statuts_chantiers: db.prepare('SELECT statut FROM chantiers ORDER BY id').all().map((ligne) => ligne.statut),
      articles: un('SELECT COUNT(*) AS valeur FROM articles'),
      approvisionnements: un("SELECT COUNT(*) AS valeur FROM mouvements_stock WHERE type = 'entree'"),
      sorties: un("SELECT COUNT(*) AS valeur FROM mouvements_stock WHERE type = 'sortie'"),
      sorties_sans_chantier: un("SELECT COUNT(*) AS valeur FROM mouvements_stock WHERE type = 'sortie' AND chantier_id IS NULL"),
      transactions: un('SELECT COUNT(*) AS valeur FROM transactions_caisse'),
      modes_caisse: db.prepare('SELECT DISTINCT mode_paiement FROM transactions_caisse ORDER BY mode_paiement').all().map((ligne) => ligne.mode_paiement),
      types_caisse: db.prepare('SELECT DISTINCT type FROM transactions_caisse ORDER BY type').all().map((ligne) => ligne.type),
      factures: un('SELECT COUNT(*) AS valeur FROM factures'),
      statuts_factures: db.prepare('SELECT statut FROM factures ORDER BY id').all().map((ligne) => ligne.statut),
      reglements: un('SELECT COUNT(*) AS valeur FROM reglements_facture'),
      reglement_sans_caisse: un('SELECT COUNT(*) AS valeur FROM reglements_facture WHERE transaction_caisse_id IS NULL'),
    };
  } finally {
    db.close();
  }
}

test('npm run seed crée une base de démonstration complète au chemin DB_PATH', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-seed-'));
  const dbPath = path.join(dir, 'demo', 'chantier.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sortie = await lancerSeed(dbPath);

  assert.ok(fs.existsSync(dbPath), `base attendue au chemin ${dbPath}`);
  assert.match(sortie, /Base de démonstration prête/);
  assert.ok(sortie.includes(dbPath), 'le script doit indiquer la base écrite');
  assert.match(sortie, /Devise affichée \(CURRENCY_SYMBOL\) : GNF/);

  const compteurs = compter(dbPath);
  // 2 clients, 2 chantiers (un en cours, un terminé).
  assert.equal(compteurs.clients, 2);
  assert.equal(compteurs.chantiers, 2);
  assert.deepEqual(compteurs.statuts_chantiers.slice().sort(), ['en_cours', 'termine']);
  // 6 matériaux usuels, approvisionnés puis consommés sur les chantiers.
  assert.equal(compteurs.articles, 6);
  assert.equal(compteurs.approvisionnements, 6);
  assert.ok(compteurs.sorties >= 6, `attendu plusieurs sorties de stock, trouvé ${compteurs.sorties}`);
  assert.equal(compteurs.sorties_sans_chantier, 0, 'chaque sortie doit être imputée à un chantier');
  // Caisse variée : espèces et mobile money, entrées et sorties.
  assert.ok(compteurs.transactions >= 6, `attendu plusieurs opérations de caisse, trouvé ${compteurs.transactions}`);
  assert.ok(compteurs.modes_caisse.includes('especes'), 'des opérations en espèces sont attendues');
  assert.ok(compteurs.modes_caisse.includes('mobile_money'), 'des opérations en mobile money sont attendues');
  assert.deepEqual(compteurs.types_caisse, ['entree', 'sortie']);
  // 2 factures dont une partiellement réglée, règlement imputé en caisse.
  assert.equal(compteurs.factures, 2);
  assert.deepEqual(compteurs.statuts_factures.slice().sort(), ['en_attente', 'partielle']);
  assert.equal(compteurs.reglements, 1);
  assert.equal(compteurs.reglement_sans_caisse, 0, 'le règlement doit créer sa ligne de caisse');
});

test('npm run seed repart d’une base propre : deux exécutions ne dupliquent rien', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-seed-2-'));
  const dbPath = path.join(dir, 'chantier.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await lancerSeed(dbPath);
  const premier = compter(dbPath);
  const secondeSortie = await lancerSeed(dbPath);
  const second = compter(dbPath);

  assert.match(secondeSortie, /Base existante supprimée/);
  assert.deepEqual(second, premier);
  assert.equal(second.clients, 2);
  assert.equal(second.factures, 2);
});

test('le seed respecte CURRENCY_SYMBOL (le règlement de démo suit la devise de l’instance)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-seed-devise-'));
  const dbPath = path.join(dir, 'chantier.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { stdout } = await executer(process.execPath, ['scripts/seed.js'], {
    cwd: RACINE,
    env: { ...process.env, DB_PATH: dbPath, CURRENCY_SYMBOL: 'FCFA' },
    timeout: 60000,
  });

  assert.match(stdout, /Devise affichée \(CURRENCY_SYMBOL\) : FCFA/);
  // La devise est une affaire d'affichage : les montants stockés restent des entiers.
  const db = openDatabase(dbPath);
  try {
    const { montant } = db.prepare('SELECT montant FROM reglements_facture').get();
    assert.equal(Number.isInteger(montant), true);
    assert.ok(montant > 0);
  } finally {
    db.close();
  }
});
