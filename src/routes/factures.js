import express from 'express';

import { MODES_PAIEMENT } from './caisse.js';
import { corpsObjet, entierPositifOuNull, idEntier, texteOuNull } from './validation.js';

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function entierPositif(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function ligneValide(ligne) {
  if (!ligne || typeof ligne !== 'object' || Array.isArray(ligne)) return null;
  const designation = texteOuNull(ligne.designation);
  const quantite = entierPositif(ligne.quantite);
  const prixUnitaire = Number.isInteger(ligne.prix_unitaire) && ligne.prix_unitaire >= 0
    ? ligne.prix_unitaire : null;
  if (!designation || !quantite || prixUnitaire === null) return null;
  return {
    designation,
    quantite,
    prix_unitaire: prixUnitaire,
    total_ligne: quantite * prixUnitaire,
  };
}

function dateValide(value, obligatoire = false) {
  const date = texteOuNull(value);
  if (date === null) return obligatoire ? null : null;
  return DATE_ISO.test(date) ? date : false;
}

function selectionFacture(db, id) {
  const facture = db.prepare(`
    SELECT f.id, f.numero, f.chantier_id, f.date_emission, f.date_echeance, f.statut,
           f.created_at, c.nom AS chantier_nom, cl.id AS client_id, cl.nom AS client_nom
    FROM factures f
    JOIN chantiers c ON c.id = f.chantier_id
    JOIN clients cl ON cl.id = c.client_id
    WHERE f.id = ?
  `).get(id);
  if (!facture) return null;

  const lignes = db.prepare(`
    SELECT id, facture_id, designation, quantite, prix_unitaire, total_ligne
    FROM lignes_facture WHERE facture_id = ? ORDER BY id
  `).all(id);
  const reglements = db.prepare(`
    SELECT id, facture_id, montant, mode_paiement, date_reglement, reference,
           transaction_caisse_id, created_at
    FROM reglements_facture WHERE facture_id = ? ORDER BY date_reglement, id
  `).all(id);
  const montant_total = lignes.reduce((total, ligne) => total + ligne.total_ligne, 0);
  const montant_regle = reglements.reduce((total, reglement) => total + reglement.montant, 0);
  return {
    ...facture,
    client: { id: facture.client_id, nom: facture.client_nom },
    chantier: { id: facture.chantier_id, nom: facture.chantier_nom },
    lignes,
    reglements,
    montant_total,
    montant_regle,
    reste_a_payer: Math.max(0, montant_total - montant_regle),
  };
}

function listeFacture(db, facture) {
  const total = db.prepare('SELECT COALESCE(SUM(total_ligne), 0) AS total FROM lignes_facture WHERE facture_id = ?').get(facture.id).total;
  const regle = db.prepare('SELECT COALESCE(SUM(montant), 0) AS total FROM reglements_facture WHERE facture_id = ?').get(facture.id).total;
  return {
    ...facture,
    montant_total: total,
    montant_regle: regle,
    reste_a_payer: Math.max(0, total - regle),
  };
}

function erreur(res, message) {
  res.status(400).json({ error: message });
}

export function createFacturesRouter() {
  const router = express.Router();

  router.get('/factures', (req, res) => {
    const db = req.app.locals.db;
    const factures = db.prepare(`
      SELECT f.id, f.numero, f.chantier_id, f.date_emission, f.date_echeance, f.statut,
             f.created_at, c.nom AS chantier_nom, cl.id AS client_id, cl.nom AS client_nom
      FROM factures f JOIN chantiers c ON c.id = f.chantier_id
      JOIN clients cl ON cl.id = c.client_id ORDER BY f.id
    `).all().map((facture) => listeFacture(db, facture));
    res.json(factures);
  });

  router.post('/factures', (req, res) => {
    const db = req.app.locals.db;
    const body = corpsObjet(req.body);
    const chantierId = entierPositifOuNull(body.chantier_id);
    const dateEmission = dateValide(body.date_emission, true);
    const dateEcheance = dateValide(body.date_echeance);
    const lignesBrutes = Array.isArray(body.lignes) ? body.lignes : body.lignes_facture;
    const lignes = Array.isArray(lignesBrutes) ? lignesBrutes.map(ligneValide) : [];

    if (!chantierId) return erreur(res, 'Le champ "chantier_id" est obligatoire');
    if (dateEmission === false || dateEmission === null) return erreur(res, 'Le champ "date_emission" doit être au format AAAA-MM-JJ');
    if (dateEcheance === false) return erreur(res, 'Le champ "date_echeance" doit être au format AAAA-MM-JJ');
    if (!lignes.length || lignes.some((ligne) => ligne === null)) return erreur(res, 'Le champ "lignes" doit contenir au moins une ligne valide');
    if (!db.prepare('SELECT id FROM chantiers WHERE id = ?').get(chantierId)) return erreur(res, `Chantier ${chantierId} introuvable`);

    const creer = db.transaction(() => {
      const annee = dateEmission.slice(0, 4);
      const precedent = db.prepare('SELECT numero FROM factures WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1').get(`FAC-${annee}-%`);
      const sequence = precedent ? Number(precedent.numero.slice(-4)) + 1 : 1;
      const numero = `FAC-${annee}-${String(sequence).padStart(4, '0')}`;
      const facture = db.prepare(`
        INSERT INTO factures (numero, chantier_id, date_emission, date_echeance, statut, created_at)
        VALUES (?, ?, ?, ?, 'en_attente', ?)
      `).run(numero, chantierId, dateEmission, dateEcheance, Date.now());
      const insererLigne = db.prepare(`
        INSERT INTO lignes_facture (facture_id, designation, quantite, prix_unitaire, total_ligne)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const ligne of lignes) insererLigne.run(facture.lastInsertRowid, ligne.designation, ligne.quantite, ligne.prix_unitaire, ligne.total_ligne);
      return facture.lastInsertRowid;
    })();
    res.status(201).json(selectionFacture(db, creer));
  });

  router.get('/factures/:id', (req, res) => {
    const id = idEntier(req.params.id);
    const facture = id === null ? null : selectionFacture(req.app.locals.db, id);
    if (!facture) return res.status(404).json({ error: `Facture ${req.params.id} introuvable` });
    res.json(facture);
  });

  router.post('/factures/:id/reglements', (req, res) => {
    const db = req.app.locals.db;
    const id = idEntier(req.params.id);
    const facture = id === null ? null : selectionFacture(db, id);
    if (!facture) return res.status(404).json({ error: `Facture ${req.params.id} introuvable` });
    const body = corpsObjet(req.body);
    const montant = entierPositif(body.montant);
    const modePaiement = texteOuNull(body.mode_paiement);
    const dateReglement = dateValide(body.date_reglement) ?? null;
    if (!montant) return erreur(res, 'Le champ "montant" doit être un entier strictement positif');
    if (!MODES_PAIEMENT.includes(modePaiement)) return erreur(res, `Le champ "mode_paiement" doit valoir ${MODES_PAIEMENT.join(', ')}`);
    if (dateReglement === false) return erreur(res, 'Le champ "date_reglement" doit être au format AAAA-MM-JJ');
    if (montant > facture.reste_a_payer) return erreur(res, 'Le montant dépasse le reste à payer');

    const enregistrer = db.transaction(() => {
      const nouveauRegle = facture.montant_regle + montant;
      const statut = nouveauRegle === facture.montant_total ? 'soldee' : 'partielle';
      const clientNom = facture.client_nom;
      const motif = `Règlement Facture ${facture.numero} - ${clientNom}`;
      const transactionCaisse = db.prepare(`
        INSERT INTO transactions_caisse
          (type, montant, mode_paiement, categorie, motif, chantier_id, date_transaction, created_at)
        VALUES ('entree', ?, ?, 'reglement_client', ?, ?, ?, ?)
      `).run(montant, modePaiement, motif, facture.chantier_id, dateReglement || new Date().toISOString().slice(0, 10), Date.now());
      const reglement = db.prepare(`
        INSERT INTO reglements_facture
          (facture_id, montant, mode_paiement, date_reglement, reference, transaction_caisse_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, montant, modePaiement, dateReglement || new Date().toISOString().slice(0, 10), texteOuNull(body.reference), transactionCaisse.lastInsertRowid, Date.now());
      db.prepare('UPDATE factures SET statut = ? WHERE id = ?').run(statut, id);
      return reglement.lastInsertRowid;
    })();
    res.status(201).json(selectionFacture(db, id));
  });

  return router;
}
