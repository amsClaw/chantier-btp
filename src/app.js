import express from 'express';

/**
 * Construit l'application Express.
 *
 * `db` est la base SQLite déjà ouverte (facultative pour l'instant : aucun
 * endpoint métier n'existe encore, la base est simplement exposée via
 * `app.locals.db` pour les histoires suivantes).
 */
export function createApp({ db } = {}) {
  const app = express();

  app.use(express.json());
  if (db) app.locals.db = db;

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
