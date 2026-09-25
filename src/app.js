import express from 'express';

import { createCaisseRouter } from './routes/caisse.js';
import { createChantiersRouter } from './routes/chantiers.js';
import { createClientsRouter } from './routes/clients.js';
import { createStockRouter } from './routes/stock.js';
import { initSchema } from './schema.js';

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

  // Histoires suivantes : ajouter ici le montage de leur routeur, sans toucher
  // aux lignes ci-dessus (src/routes/<domaine>.js).
  app.use('/api/clients', createClientsRouter());
  app.use('/api', createStockRouter());
  app.use('/api', createCaisseRouter());
  app.use('/api/chantiers', createChantiersRouter());

  return app;
}
