import express from 'express';

import { corpsObjet, entierPositifOuNull, idEntier, texteOuNull } from './validation.js';

/** Types d'opération acceptés (miroir de la contrainte CHECK de la table). */
export const TYPES_CAISSE = ['entree', 'sortie'];

/** Modes de paiement acceptés (miroir de la contrainte CHECK de la table). */
export const MODES_PAIEMENT = ['especes', 'mobile_money', 'virement', 'cheque'];

/** Catégories de chantier courantes (critère 3 de l'histoire 4). */
export const CATEGORIES_CAISSE = [
  'achat_materiaux',
  'main_d_oeuvre',
  'carburant',
  'transport',
  'apport_caisse',
  'reglement_client',
  'divers',
];

/** Colonnes exposées par l'API (contrat explicite, pas de `SELECT *`). */
export const CHAMPS_TRANSACTION =
  'id, type, montant, mode_paiement, categorie, motif, chantier_id, date_transaction, created_at';

const DATE_TRANSACTION = /^\d{4}-\d{2}-\d{2}$/;

/** Date du jour au format `AAAA-MM-JJ`, dans le fuseau du poste (jour local). */
function jourCourant() {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

/**
 * Routeur du journal de caisse.
 *
 * La base est lue à chaque requête dans `req.app.locals.db` (posé par
 * `createApp`), comme les autres routeurs : les tests peuvent démarrer
 * plusieurs serveurs en parallèle.
 *
 * Monté sur `/api` par src/app.js, il sert donc :
 *   GET  /api/caisse/solde
 *   GET  /api/caisse/transactions[?chantier_id=...]
 *   POST /api/caisse/transactions
 *
 * Aucun solde n'est stocké : tout est recalculé depuis les lignes présentes,
 * il ne peut donc pas y avoir d'écart entre le journal et le solde affiché.
 */
export function createCaisseRouter() {
  const router = express.Router();

  // GET /api/caisse/solde — solde net = total des entrées - total des sorties.
  router.get('/caisse/solde', (req, res) => {
    const totaux = req.app.locals.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'entree' THEN montant ELSE 0 END), 0) AS total_entrees,
        COALESCE(SUM(CASE WHEN type = 'sortie' THEN montant ELSE 0 END), 0) AS total_sorties
      FROM transactions_caisse
    `).get();

    res.json({
      solde: totaux.total_entrees - totaux.total_sorties,
      total_entrees: totaux.total_entrees,
      total_sorties: totaux.total_sorties,
    });
  });

  // GET /api/caisse/transactions — journal, opération la plus récente en tête.
  router.get('/caisse/transactions', (req, res) => {
    const db = req.app.locals.db;
    const filtreBrut = req.query.chantier_id;

    // Sans `?chantier_id=`, ou avec une valeur vide : tout le journal.
    if (texteOuNull(filtreBrut) === null) {
      res.json(db.prepare(
        `SELECT ${CHAMPS_TRANSACTION} FROM transactions_caisse ORDER BY date_transaction DESC, id DESC`,
      ).all());
      return;
    }

    const chantierId = idEntier(filtreBrut);
    if (!chantierId) {
      res.status(400).json({ error: 'Le paramètre "chantier_id" doit être un entier positif' });
      return;
    }

    res.json(db.prepare(`
      SELECT ${CHAMPS_TRANSACTION} FROM transactions_caisse
      WHERE chantier_id = ? ORDER BY date_transaction DESC, id DESC
    `).all(chantierId));
  });

  // POST /api/caisse/transactions — enregistre une entrée ou une sortie.
  router.post('/caisse/transactions', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);

    const type = texteOuNull(body.type);
    const montant = entierPositifOuNull(body.montant);
    const modePaiement = texteOuNull(body.mode_paiement);
    const categorie = texteOuNull(body.categorie);
    const motif = texteOuNull(body.motif);

    if (!TYPES_CAISSE.includes(type)) {
      res.status(400).json({ error: `Le champ "type" doit valoir ${TYPES_CAISSE.join(' ou ')}` });
      return;
    }
    if (!montant) {
      res.status(400).json({ error: 'Le champ "montant" doit être un entier strictement positif' });
      return;
    }
    if (!MODES_PAIEMENT.includes(modePaiement)) {
      res.status(400).json({ error: `Le champ "mode_paiement" doit valoir ${MODES_PAIEMENT.join(', ')}` });
      return;
    }
    if (!categorie || !CATEGORIES_CAISSE.includes(categorie)) {
      res.status(400).json({ error: `Le champ "categorie" doit valoir ${CATEGORIES_CAISSE.join(', ')}` });
      return;
    }
    if (!motif) {
      res.status(400).json({ error: 'Le champ "motif" est obligatoire' });
      return;
    }

    // `date_transaction` est facultative : à défaut, on date l'opération du jour.
    let dateTransaction = jourCourant();
    if (texteOuNull(body.date_transaction) !== null) {
      dateTransaction = texteOuNull(body.date_transaction);
      if (!DATE_TRANSACTION.test(dateTransaction)) {
        res.status(400).json({ error: 'Le champ "date_transaction" doit être au format AAAA-MM-JJ' });
        return;
      }
    }

    let chantierId = null;
    if (texteOuNull(body.chantier_id) !== null) {
      chantierId = entierPositifOuNull(body.chantier_id);
      if (!chantierId) {
        res.status(400).json({ error: 'Le champ "chantier_id" doit être un entier positif' });
        return;
      }
      if (!db.prepare('SELECT id FROM chantiers WHERE id = ?').get(chantierId)) {
        res.status(400).json({ error: `Chantier ${chantierId} introuvable` });
        return;
      }
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO transactions_caisse
        (type, montant, mode_paiement, categorie, motif, chantier_id, date_transaction, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type, montant, modePaiement, categorie, motif, chantierId, dateTransaction, Date.now());

    res.status(201).json(
      db.prepare(`SELECT ${CHAMPS_TRANSACTION} FROM transactions_caisse WHERE id = ?`).get(lastInsertRowid),
    );
  });

  return router;
}
