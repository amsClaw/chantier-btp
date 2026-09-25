import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createCaisseRouter } from './routes/caisse.js';
import { createFacturesRouter } from './routes/factures.js';
import { createChantiersRouter } from './routes/chantiers.js';
import { createClientsRouter } from './routes/clients.js';
import { createStockRouter } from './routes/stock.js';
import { initSchema } from './schema.js';

/** Racine du dépôt (le module vit dans src/), d'où sont servis index.html et public/. */
const RACINE_UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Sert l'interface mobile-first (histoire 6) : une page unique sur `GET /` et ses
 * ressources statiques sous `/public/`. Aucun outil de build : le navigateur reçoit
 * l'HTML, le CSS et le JS tels qu'ils sont écrits dans le dépôt.
 *
 * Seul `index.html` et `public/` sont exposés ; le code serveur (`src/`) reste privé.
 *
 * `dotfiles: 'allow'` est nécessaire et sans risque : le chemin servi est choisi par
 * le serveur (aucune entrée utilisateur), mais il traverse `.worktrees/<carte>/` quand
 * l'application tourne depuis le bac à sable d'une carte de l'usine. Sans cette option,
 * `sendFile` masque tout chemin contenant un segment commençant par un point et `GET /`
 * répondrait 404.
 */
function servirInterface(app) {
  app.use('/public', express.static(path.join(RACINE_UI, 'public'), { index: false }));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(RACINE_UI, 'index.html'), { dotfiles: 'allow' });
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

  // Interface mobile-first (histoire 6) : page unique + ressources statiques.
  servirInterface(app);

  // Histoires suivantes : ajouter ici le montage de leur routeur, sans toucher
  // aux lignes ci-dessus (src/routes/<domaine>.js).
  app.use('/api/clients', createClientsRouter());
  app.use('/api', createStockRouter());
  app.use('/api', createCaisseRouter());
  app.use('/api', createFacturesRouter());
  app.use('/api/chantiers', createChantiersRouter());

  return app;
}
