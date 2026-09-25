import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { configurationPublique, echapperHtml, resolveCurrencySymbol } from './config.js';
import { createCaisseRouter } from './routes/caisse.js';
import { createFacturesRouter } from './routes/factures.js';
import { createChantiersRouter } from './routes/chantiers.js';
import { createClientsRouter } from './routes/clients.js';
import { createStockRouter } from './routes/stock.js';
import { initSchema } from './schema.js';

/** Racine du dépôt (le module vit dans src/), d'où sont servis index.html et public/. */
const RACINE_UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Chemin de la page unique de l'interface. */
const CHEMIN_INDEX = path.join(RACINE_UI, 'index.html');

/** Gabarit HTML mis en cache : le fichier ne change pas pendant la vie du serveur. */
let gabaritIndex = null;

/**
 * Page d'accueil de l'interface, symbole monétaire interpolé.
 *
 * `index.html` porte le jeton `{{CURRENCY_SYMBOL}}` : il est remplacé à chaque
 * requête par la valeur courante de `CURRENCY_SYMBOL`, ce qui rend la devise
 * visible dès le premier affichage (avant même que le JavaScript ne récupère
 * `GET /api/config`). Le fichier est lu une fois puis gardé en mémoire.
 */
function pageAccueil() {
  if (gabaritIndex === null) gabaritIndex = fs.readFileSync(CHEMIN_INDEX, 'utf8');
  return gabaritIndex.replaceAll('{{CURRENCY_SYMBOL}}', echapperHtml(resolveCurrencySymbol()));
}

/**
 * Sert l'interface mobile-first (histoire 6) : une page unique sur `GET /` et ses
 * ressources statiques sous `/public/`. Aucun outil de build : le navigateur reçoit
 * l'HTML, le CSS et le JS tels qu'ils sont écrits dans le dépôt.
 *
 * Seul `index.html` et `public/` sont exposés ; le code serveur (`src/`) reste privé.
 * La page est envoyée par `res.send` après substitution du jeton de devise, et non
 * par `res.sendFile` : le contenu est déjà lu côté serveur, aucun chemin du système
 * de fichiers ne dépend de la requête.
 */
function servirInterface(app) {
  app.use('/public', express.static(path.join(RACINE_UI, 'public'), { index: false }));
  app.get('/', (_req, res, next) => {
    try {
      res.type('html').send(pageAccueil());
    } catch (erreur) {
      next(erreur);
    }
  });
}

/**
 * Construit l'application Express.
 *
 * `db` est la base SQLite déjà ouverte (posée dans `app.locals.db` pour que les
 * routeurs la lisent à chaque requête). Quand elle est fournie, le schéma est
 * (re)vérifié : `initSchema` est idempotent, une application construite à la
 * main sur une base ouverte n'a donc jamais de table manquante.
 */
export function createApp({ db } = {}) {
  const app = express();

  app.use(express.json());
  if (db) {
    app.locals.db = db;
    initSchema(db);
  }

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Configuration publique de l'instance (histoire 7) : la devise affichée par
  // l'interface, pilotée par `CURRENCY_SYMBOL`. Lue en direct à chaque appel, la
  // réponse suit donc l'environnement du processus.
  app.get('/api/config', (_req, res) => {
    res.json(configurationPublique());
  });

  // Interface mobile-first (histoire 6) : page unique + ressources statiques.
  servirInterface(app);

  // Histoires suivantes : ajouter ici le montage de leur routeur, sans toucher
  // aux lignes ci-dessus (src/routes/<domaine>.js).
  app.use('/api/clients', createClientsRouter());
  app.use('/api', createStockRouter());
  app.use('/api', createCaisseRouter());
  app.use('/api', createFacturesRouter());
  app.use('/api/chantiers', createChantiersRouter());

  // Route API inconnue : 404 JSON, jamais une page HTML d'erreur (exigence 12).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API inconnue' });
  });

  // Toujours en dernier : capture toute exception non prévue d'une route.
  app.use(gestionnaireErreurs);

  return app;
}

/**
 * Middleware d'erreur global (4 arguments : Express ne le reconnaît qu'ainsi).
 *
 * Garantit qu'aucune exception inattendue ne remonte jusqu'à Node.js — le
 * processus ne s'arrête donc jamais à cause d'une requête — et qu'une erreur est
 * toujours renvoyée en JSON. Les erreurs portant un `status` (corps JSON
 * malformé, par exemple) conservent leur code ; les autres deviennent un 500
 * générique dont le détail est journalisé côté serveur, jamais renvoyé au client.
 */
export function gestionnaireErreurs(erreur, _req, res, next) {
  if (res.headersSent) {
    next(erreur);
    return;
  }

  const statut = Number.isInteger(erreur && erreur.status) && erreur.status >= 400 && erreur.status <= 599
    ? erreur.status
    : 500;

  if (statut >= 500) {
    console.error(`Erreur non gérée : ${erreur && erreur.stack ? erreur.stack : erreur}`);
    res.status(statut).json({ error: 'Erreur interne du serveur' });
    return;
  }

  res.status(statut).json({ error: (erreur && erreur.message) || 'Requête invalide' });
}
