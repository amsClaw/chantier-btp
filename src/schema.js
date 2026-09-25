/**
 * Schéma SQLite du produit, en un seul endroit.
 *
 * Toutes les tables sont créées au démarrage avec `CREATE TABLE IF NOT EXISTS` :
 * la fonction est donc idempotente et peut être appelée sans risque à chaque
 * ouverture de base. C'est `openDatabase()` (src/db.js) qui l'appelle, et
 * `createApp()` (src/app.js) la rappelle si on lui passe une base déjà ouverte.
 *
 * Les tables arrivent histoire par histoire (docs/HISTOIRES.md) : ce fichier est
 * le point d'extension naturel. Les histoires suivantes ajoutent leurs tables à
 * la suite du tableau, sans toucher aux instructions déjà écrites.
 */

export const SCHEMA_STATEMENTS = [
  // Histoire 2 — Clients et chantiers.
  `CREATE TABLE IF NOT EXISTS clients (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     nom TEXT NOT NULL,
     telephone TEXT,
     adresse TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS chantiers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     client_id INTEGER NOT NULL REFERENCES clients(id),
     nom TEXT NOT NULL,
     lieu TEXT,
     statut TEXT DEFAULT 'en_cours',
     date_debut TEXT,
     created_at INTEGER NOT NULL
   )`,
];

/**
 * Crée les tables manquantes. Renvoie la base, pour enchaîner.
 */
export function initSchema(db) {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement);
  }
  return db;
}
