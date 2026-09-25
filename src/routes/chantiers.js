import express from 'express';

import { CHAMPS_CLIENT } from './clients.js';
import { corpsObjet, entierPositifOuNull, idEntier, texteOuNull } from './validation.js';

/** Statuts d'un chantier (docs/SPEC.md, exigence 4). */
export const STATUTS = ['en_cours', 'termine'];

/** Statut appliqué quand la création n'en fournit aucun (défaut du schéma). */
export const STATUT_PAR_DEFAUT = 'en_cours';

/** Colonnes d'un chantier renvoyées par l'API. */
export const CHAMPS_CHANTIER = 'id, client_id, nom, lieu, statut, date_debut, created_at';

/** Champs modifiables par `PATCH /api/chantiers/:id`. */
export const CHAMPS_MODIFIABLES = ['nom', 'lieu', 'date_debut', 'statut'];

const SELECTION_LISTE = `
  SELECT c.id, c.client_id, c.nom, c.lieu, c.statut, c.date_debut, c.created_at,
         cl.nom AS client_nom
    FROM chantiers c
    JOIN clients cl ON cl.id = c.client_id
`;

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Date `AAAA-MM-JJ`, ou `null` si absente/vide. Renvoie `false` si mal formée. */
function dateOuNull(value) {
  const texte = texteOuNull(value);
  if (texte === null) return null;
  return DATE_ISO.test(texte) ? texte : false;
}

/** Détail d'un chantier : ses colonnes + son client imbriqué. `null` si inconnu. */
export function chargerChantier(db, id) {
  const chantier = db.prepare(`SELECT ${CHAMPS_CHANTIER} FROM chantiers WHERE id = ?`).get(id);
  if (!chantier) return null;

  const client = db.prepare(`SELECT ${CHAMPS_CLIENT} FROM clients WHERE id = ?`).get(chantier.client_id);
  return { ...chantier, client_nom: client ? client.nom : null, client: client ?? null };
}

/**
 * Routeur des chantiers, monté sur `/api/chantiers` par src/app.js.
 *
 * Contrat :
 *   GET    /api/chantiers[?statut=en_cours|termine]
 *   POST   /api/chantiers
 *   GET    /api/chantiers/:id
 *   PATCH  /api/chantiers/:id
 */
export function createChantiersRouter() {
  const router = express.Router();

  // GET /api/chantiers — liste avec le nom du client associé.
  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const statutDemande = req.query.statut;

    if (statutDemande !== undefined) {
      const statut = texteOuNull(statutDemande);
      if (!STATUTS.includes(statut)) {
        res.status(400).json({
          error: `Le paramètre "statut" doit valoir ${STATUTS.join(' ou ')}`,
        });
        return;
      }
      res.json(db.prepare(`${SELECTION_LISTE} WHERE c.statut = ? ORDER BY c.id`).all(statut));
      return;
    }

    res.json(db.prepare(`${SELECTION_LISTE} ORDER BY c.id`).all());
  });

  // POST /api/chantiers — { client_id (obligatoire, existant), nom (obligatoire),
  //                         lieu?, statut?, date_debut? }
  router.post('/', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);

    const clientId = entierPositifOuNull(body.client_id);
    const nom = texteOuNull(body.nom);
    if (!clientId && !nom) {
      res.status(400).json({ error: 'Les champs "client_id" et "nom" sont obligatoires' });
      return;
    }
    if (!clientId) {
      res.status(400).json({ error: 'Le champ "client_id" est obligatoire' });
      return;
    }
    if (!nom) {
      res.status(400).json({ error: 'Le champ "nom" est obligatoire' });
      return;
    }

    const statut = body.statut === undefined ? STATUT_PAR_DEFAUT : texteOuNull(body.statut);
    if (!STATUTS.includes(statut)) {
      res.status(400).json({ error: `Le champ "statut" doit valoir ${STATUTS.join(' ou ')}` });
      return;
    }

    const dateDebut = dateOuNull(body.date_debut);
    if (dateDebut === false) {
      res.status(400).json({ error: 'Le champ "date_debut" doit être au format AAAA-MM-JJ' });
      return;
    }

    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
    if (!client) {
      res.status(400).json({ error: `Aucun client avec l'identifiant ${clientId}` });
      return;
    }

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO chantiers (client_id, nom, lieu, statut, date_debut, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(clientId, nom, texteOuNull(body.lieu), statut, dateDebut, Date.now());

    res.status(201).json(chargerChantier(db, lastInsertRowid));
  });

  // GET /api/chantiers/:id — détail avec les données du client (404 si inconnu).
  router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = idEntier(req.params.id);

    const chantier = id === null ? null : chargerChantier(db, id);
    if (!chantier) {
      res.status(404).json({ error: `Chantier ${req.params.id} introuvable` });
      return;
    }
    res.json(chantier);
  });

  // PATCH /api/chantiers/:id — statut (clôture) et détails du chantier.
  router.patch('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = idEntier(req.params.id);

    if (id === null || !db.prepare('SELECT id FROM chantiers WHERE id = ?').get(id)) {
      res.status(404).json({ error: `Chantier ${req.params.id} introuvable` });
      return;
    }

    const body = corpsObjet(req.body);
    const modifications = {};

    if (Object.hasOwn(body, 'nom')) {
      const nom = texteOuNull(body.nom);
      if (!nom) {
        res.status(400).json({ error: 'Le champ "nom" ne peut pas être vide' });
        return;
      }
      modifications.nom = nom;
    }

    if (Object.hasOwn(body, 'lieu')) {
      modifications.lieu = texteOuNull(body.lieu);
    }

    if (Object.hasOwn(body, 'date_debut')) {
      const dateDebut = dateOuNull(body.date_debut);
      if (dateDebut === false) {
        res.status(400).json({ error: 'Le champ "date_debut" doit être au format AAAA-MM-JJ' });
        return;
      }
      modifications.date_debut = dateDebut;
    }

    if (Object.hasOwn(body, 'statut')) {
      const statut = texteOuNull(body.statut);
      if (!STATUTS.includes(statut)) {
        res.status(400).json({ error: `Le champ "statut" doit valoir ${STATUTS.join(' ou ')}` });
        return;
      }
      modifications.statut = statut;
    }

    if (Object.keys(modifications).length === 0) {
      res.status(400).json({
        error: `Aucun champ modifiable fourni (${CHAMPS_MODIFIABLES.join(', ')})`,
      });
      return;
    }

    const affectations = Object.keys(modifications)
      .map((champ) => `${champ} = @${champ}`)
      .join(', ');
    db.prepare(`UPDATE chantiers SET ${affectations} WHERE id = @id`).run({ ...modifications, id });

    res.json(chargerChantier(db, id));
  });

  return router;
}
