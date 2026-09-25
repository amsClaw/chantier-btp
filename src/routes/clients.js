import express from 'express';

import { corpsObjet, texteOuNull } from './validation.js';

/** Colonnes exposées par l'API (aucun `SELECT *` : le contrat reste explicite). */
export const CHAMPS_CLIENT = 'id, nom, telephone, adresse, created_at';

/**
 * Routeur des clients.
 *
 * La base est lue à chaque requête dans `req.app.locals.db` (posé par
 * `createApp`), ce qui évite de capturer une connexion à la construction du
 * routeur : les tests peuvent démarrer plusieurs serveurs en parallèle.
 *
 * Monté sur `/api/clients` par src/app.js.
 */
export function createClientsRouter() {
  const router = express.Router();

  // GET /api/clients — tous les clients, du plus ancien au plus récent.
  router.get('/', (req, res) => {
    const clients = req.app.locals.db
      .prepare(`SELECT ${CHAMPS_CLIENT} FROM clients ORDER BY id`)
      .all();
    res.json(clients);
  });

  // POST /api/clients — { nom (obligatoire), telephone?, adresse? }
  router.post('/', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);

    const nom = texteOuNull(body.nom);
    if (!nom) {
      res.status(400).json({ error: 'Le champ "nom" est obligatoire' });
      return;
    }

    const { lastInsertRowid } = db
      .prepare('INSERT INTO clients (nom, telephone, adresse, created_at) VALUES (?, ?, ?, ?)')
      .run(nom, texteOuNull(body.telephone), texteOuNull(body.adresse), Date.now());

    res
      .status(201)
      .json(db.prepare(`SELECT ${CHAMPS_CLIENT} FROM clients WHERE id = ?`).get(lastInsertRowid));
  });

  return router;
}
