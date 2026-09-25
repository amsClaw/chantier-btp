import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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
 * Ouvre (et crée au besoin) la base SQLite.
 *
 * Le répertoire parent est créé récursivement s'il n'existe pas : sur un poste
 * de chantier, `./data/` n'existe jamais au premier démarrage.
 *
 * Aucune table métier n'est créée ici : les tables (clients, chantiers, stocks,
 * caisse, factures) arrivent avec leurs histoires respectives.
 */
export function openDatabase(dbPath) {
  const resolved = resolveDbPath(dbPath);
  fs.mkdirSync(path.dirname(path.resolve(resolved)), { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
