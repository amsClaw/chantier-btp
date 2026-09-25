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
  // Histoire 3 — Articles et mouvements de stock.
  `CREATE TABLE IF NOT EXISTS articles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     nom TEXT NOT NULL,
     unite TEXT NOT NULL,
     seuil_alerte INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS mouvements_stock (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     article_id INTEGER NOT NULL REFERENCES articles(id),
     chantier_id INTEGER REFERENCES chantiers(id),
     type TEXT NOT NULL CHECK(type IN ('entree', 'sortie')),
     quantite INTEGER NOT NULL CHECK(quantite > 0),
     date_mouvement TEXT NOT NULL,
     motif TEXT,
     created_at INTEGER NOT NULL
   )`,
  // Histoire 4 — Journal de caisse (entrées / sorties d'argent du terrain).
  `CREATE TABLE IF NOT EXISTS transactions_caisse (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL CHECK(type IN ('entree', 'sortie')),
     montant INTEGER NOT NULL CHECK(montant > 0),
     mode_paiement TEXT NOT NULL CHECK(mode_paiement IN ('especes', 'mobile_money', 'virement', 'cheque')),
     categorie TEXT NOT NULL,
     motif TEXT NOT NULL,
     chantier_id INTEGER REFERENCES chantiers(id),
     date_transaction TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  // Histoire 5 — Facturation, lignes de détail et règlements clients.
  `CREATE TABLE IF NOT EXISTS factures (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     numero TEXT UNIQUE NOT NULL,
     chantier_id INTEGER NOT NULL REFERENCES chantiers(id),
     date_emission TEXT NOT NULL,
     date_echeance TEXT,
     statut TEXT DEFAULT 'en_attente' CHECK(statut IN ('en_attente', 'partielle', 'soldee')),
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS lignes_facture (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     facture_id INTEGER NOT NULL REFERENCES factures(id),
     designation TEXT NOT NULL,
     quantite INTEGER NOT NULL CHECK(quantite > 0),
     prix_unitaire INTEGER NOT NULL CHECK(prix_unitaire >= 0),
     total_ligne INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reglements_facture (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     facture_id INTEGER NOT NULL REFERENCES factures(id),
     montant INTEGER NOT NULL CHECK(montant > 0),
     mode_paiement TEXT NOT NULL,
     date_reglement TEXT NOT NULL,
     reference TEXT,
     transaction_caisse_id INTEGER REFERENCES transactions_caisse(id),
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
