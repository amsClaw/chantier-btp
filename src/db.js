import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initSchema } from './schema.js';

/**
 * Chemin de la base par défaut, surchargeable par la variable d'environnement
 * `DB_PATH` (exigence : `process.env.DB_PATH || './data/chantier.sqlite'`).
 */
export const DEFAULT_DB_PATH = './data/chantier.sqlite';

/** Chemin effectif de la base : `DB_PATH` si fourni, sinon le défaut. */
export function resolveDbPath(dbPath) {
  return dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
}

/**
 * Ouvre (et crée au besoin) la base SQLite, puis crée les tables manquantes
 * (`initSchema`, CREATE TABLE IF NOT EXISTS : l'appel est idempotent).
 *
 * Le répertoire parent est créé récursivement s'il n'existe pas : sur un poste
 * de chantier, `./data/` n'existe jamais au premier démarrage.
 *
 * Les tables des histoires suivantes (stocks, caisse, factures) sont ajoutées
 * dans src/schema.js.
 */
export function openDatabase(dbPath) {
  const resolved = resolveDbPath(dbPath);
  fs.mkdirSync(path.dirname(path.resolve(resolved)), { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}
