import express from 'express';

import { corpsObjet, entierPositifOuNull, idEntier, texteOuNull } from './validation.js';

export const UNITES = ['sac', 'barre', 'm3', 'tonne', 'litre', 'piece', 'kg', 'metre', 'lot'];

const DATE_MOUVEMENT = /^\d{4}-\d{2}-\d{2}$/;

function dateValide(value) {
  const date = texteOuNull(value);
  return date && DATE_MOUVEMENT.test(date) ? date : null;
}

function stockActuel(db, articleId) {
  return db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'entree' THEN quantite ELSE -quantite END), 0) AS stock_actuel
    FROM mouvements_stock WHERE article_id = ?
  `).get(articleId).stock_actuel;
}

function articleAvecStock(db, articleId) {
  const article = db.prepare('SELECT id, nom, unite, seuil_alerte, created_at FROM articles WHERE id = ?').get(articleId);
  return article ? { ...article, stock_actuel: stockActuel(db, articleId) } : null;
}

export function createStockRouter() {
  const router = express.Router();

  router.get('/articles', (req, res) => {
    const articles = req.app.locals.db.prepare(`
      SELECT a.id, a.nom, a.unite, a.seuil_alerte, a.created_at,
             COALESCE(SUM(CASE WHEN m.type = 'entree' THEN m.quantite ELSE -m.quantite END), 0) AS stock_actuel
      FROM articles a LEFT JOIN mouvements_stock m ON m.article_id = a.id
      GROUP BY a.id ORDER BY a.id
    `).all();
    res.json(articles);
  });

  router.post('/articles', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);
    const nom = texteOuNull(body.nom);
    const unite = texteOuNull(body.unite);
    const seuil = body.seuil_alerte === undefined ? 0 : Number(body.seuil_alerte);
    if (!nom || !unite || !Number.isSafeInteger(seuil) || seuil < 0) {
      res.status(400).json({ error: 'Les champs "nom" et "unite" sont obligatoires; seuil_alerte doit être un entier positif ou nul' });
      return;
    }
    if (!UNITES.includes(unite)) {
      res.status(400).json({ error: `Le champ "unite" doit valoir ${UNITES.join(', ')}` });
      return;
    }
    const result = db.prepare('INSERT INTO articles (nom, unite, seuil_alerte, created_at) VALUES (?, ?, ?, ?)')
      .run(nom, unite, seuil, Date.now());
    res.status(201).json(articleAvecStock(db, result.lastInsertRowid));
  });

  router.post('/stock/mouvements', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);
    const articleId = entierPositifOuNull(body.article_id);
    const quantite = entierPositifOuNull(body.quantite);
    const type = texteOuNull(body.type);
    const date = dateValide(body.date_mouvement);
    const chantierId = body.chantier_id === undefined ? null : entierPositifOuNull(body.chantier_id);
    if (!articleId || !quantite || !['entree', 'sortie'].includes(type) || !date) {
      res.status(400).json({ error: 'article_id, type, quantite et date_mouvement sont obligatoires' });
      return;
    }
    if (!db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId)) {
      res.status(400).json({ error: `Article ${articleId} introuvable` });
      return;
    }
    if (type === 'sortie' && !chantierId) {
      res.status(400).json({ error: 'chantier_id est obligatoire pour une sortie' });
      return;
    }
    if (chantierId && !db.prepare('SELECT id FROM chantiers WHERE id = ?').get(chantierId)) {
      res.status(400).json({ error: `Chantier ${chantierId} introuvable` });
      return;
    }
    if (type === 'sortie') {
      const stock = stockActuel(db, articleId);
      if (quantite > stock) {
        res.status(400).json({ error: 'Stock insuffisant', stock_actuel: stock });
        return;
      }
    }
    const result = db.prepare(`
      INSERT INTO mouvements_stock (article_id, chantier_id, type, quantite, date_mouvement, motif, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(articleId, chantierId, type, quantite, date, texteOuNull(body.motif), Date.now());
    res.status(201).json(db.prepare('SELECT * FROM mouvements_stock WHERE id = ?').get(result.lastInsertRowid));
  });

  router.get('/chantiers/:id/consommations', (req, res) => {
    const db = req.app.locals.db;
    const chantierId = idEntier(req.params.id);
    if (!chantierId || !db.prepare('SELECT id FROM chantiers WHERE id = ?').get(chantierId)) {
      res.status(404).json({ error: `Chantier ${req.params.id} introuvable` });
      return;
    }
    res.json(db.prepare(`
      SELECT m.id, m.article_id, a.nom AS article_nom, a.unite, m.quantite,
             m.date_mouvement, m.motif, m.created_at, m.chantier_id
      FROM mouvements_stock m JOIN articles a ON a.id = m.article_id
      WHERE m.chantier_id = ? AND m.type = 'sortie' ORDER BY m.id
    `).all(chantierId));
  });

  return router;
}
