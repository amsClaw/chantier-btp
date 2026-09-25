#!/usr/bin/env node
/**
 * Jeu de données de démonstration : `npm run seed`.
 *
 * Objectif : pouvoir montrer l'application remplie avec un cas réaliste de PME BTP
 * (deux clients, deux chantiers dont un terminé, six matériaux usuels, mouvements
 * de stock, caisse en espèces et en mobile money, deux factures dont une
 * partiellement réglée) sans saisir quoi que ce soit à la main.
 *
 * Choix d'implémentation : le script démarre le **vrai serveur** sur un port libre
 * puis l'alimente par des appels HTTP à l'API publique. Aucune règle métier n'est
 * dupliquée ici : la numérotation des factures, l'imputation automatique des
 * règlements en caisse et les contrôles de stock restent dans `src/routes/`, donc
 * les données de démonstration sont exactement celles que produirait la saisie.
 *
 * Base « propre » (contrairement à `npm start` qui complète une base existante) :
 * le fichier SQLite désigné par `DB_PATH` — ou par défaut `./data/chantier.sqlite` —
 * est supprimé avant le remplissage.
 *
 * Usage :
 *   npm run seed
 *   DB_PATH=/tmp/demo.sqlite npm run seed
 */

import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveCurrencySymbol } from '../src/config.js';
import { resolveDbPath } from '../src/db.js';
import { startServer } from '../src/server.js';

/** Date `AAAA-MM-JJ` décalée de `jours` par rapport à aujourd'hui (jour local). */
function jour(jours = 0) {
  const date = new Date();
  date.setDate(date.getDate() + jours);
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const quantieme = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${quantieme}`;
}

/** Appel API JSON ; lève une erreur explicite dès qu'une route refuse la requête. */
async function publier(url, chemin, corps, methode = 'POST') {
  const reponse = await fetch(`${url}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    throw new Error(`${methode} ${chemin} : HTTP ${reponse.status} — ${(donnees && donnees.error) || 'réponse illisible'}`);
  }
  return donnees;
}

/**
 * Remplit la base servie par `url` et renvoie un résumé de ce qui a été créé.
 *
 * Exporté pour être testé sans lancer de processus : `test/seed.test.js` appelle
 * `main()`, qui réutilise cette fonction.
 */
export async function remplirBase(url) {
  /* --- Clients ------------------------------------------------------------ */
  const kaba = await publier(url, '/api/clients', {
    nom: 'Société Immobilière Kaba',
    telephone: '+224 622 45 18 07',
    adresse: 'Kaloum, Conakry',
  });
  const camara = await publier(url, '/api/clients', {
    nom: 'Ets Camara & Fils',
    telephone: '+224 628 90 33 12',
    adresse: 'Matoto, Conakry',
  });

  /* --- Chantiers : un en cours, un terminé -------------------------------- */
  const palmeraie = await publier(url, '/api/chantiers', {
    client_id: kaba.id,
    nom: 'Résidence Palmeraie',
    lieu: 'Kagbélen, Coyah',
    statut: 'en_cours',
    date_debut: jour(-45),
  });
  const kipe = await publier(url, '/api/chantiers', {
    client_id: camara.id,
    nom: 'Villa Kipé',
    lieu: 'Kipé, Ratoma',
    statut: 'termine',
    date_debut: jour(-150),
  });

  /* --- Catalogue : six matériaux usuels, approvisionnés puis consommés ----- */
  const catalogue = [
    {
      nom: 'Ciment CIM II 42,5', unite: 'sac', seuil_alerte: 60,
      entree: { quantite: 400, date: jour(-40), motif: 'Livraison dépôt Kaloum' },
      sorties: [
        { chantier: palmeraie, quantite: 180, date: jour(-32), motif: 'Fondations et dallage' },
        { chantier: kipe, quantite: 60, date: jour(-28), motif: 'Chapes et enduits' },
      ],
    },
    {
      nom: 'Fer à béton 12 mm', unite: 'barre', seuil_alerte: 50,
      entree: { quantite: 300, date: jour(-39), motif: 'Livraison dépôt Kaloum' },
      sorties: [
        { chantier: palmeraie, quantite: 120, date: jour(-31), motif: 'Armatures poteaux et poutres' },
        { chantier: kipe, quantite: 40, date: jour(-27), motif: 'Chaînages' },
      ],
    },
    {
      nom: 'Sable de rivière', unite: 'm3', seuil_alerte: 5,
      entree: { quantite: 40, date: jour(-38), motif: 'Camion benne n° 1' },
      sorties: [
        { chantier: palmeraie, quantite: 12, date: jour(-30), motif: 'Béton de fondation' },
      ],
    },
    {
      nom: 'Gravier 15/25', unite: 'm3', seuil_alerte: 5,
      entree: { quantite: 30, date: jour(-38), motif: 'Camion benne n° 2' },
      sorties: [
        { chantier: palmeraie, quantite: 9, date: jour(-30), motif: 'Béton de fondation' },
      ],
    },
    {
      nom: 'Parpaings 15x20x40', unite: 'piece', seuil_alerte: 200,
      entree: { quantite: 1200, date: jour(-36), motif: 'Commande bloquée à la presse' },
      sorties: [
        { chantier: palmeraie, quantite: 450, date: jour(-25), motif: 'Élévation des murs' },
      ],
    },
    {
      nom: 'Gasoil', unite: 'litre', seuil_alerte: 60,
      entree: { quantite: 300, date: jour(-35), motif: 'Bidons de 200 L' },
      sorties: [
        { chantier: palmeraie, quantite: 80, date: jour(-24), motif: 'Groupe électrogène' },
        { chantier: kipe, quantite: 40, date: jour(-22), motif: 'Groupe électrogène' },
      ],
    },
  ];

  let mouvements = 0;
  for (const article of catalogue) {
    const cree = await publier(url, '/api/articles', {
      nom: article.nom,
      unite: article.unite,
      seuil_alerte: article.seuil_alerte,
    });
    await publier(url, '/api/stock/mouvements', {
      article_id: cree.id,
      type: 'entree',
      quantite: article.entree.quantite,
      date_mouvement: article.entree.date,
      motif: article.entree.motif,
    });
    mouvements += 1;
    for (const sortie of article.sorties) {
      await publier(url, '/api/stock/mouvements', {
        article_id: cree.id,
        type: 'sortie',
        quantite: sortie.quantite,
        chantier_id: sortie.chantier.id,
        date_mouvement: sortie.date,
        motif: sortie.motif,
      });
      mouvements += 1;
    }
  }

  /* --- Caisse : espèces et mobile money, entrées et sorties ---------------- */
  const operations = [
    { type: 'entree', montant: 12_000_000, mode_paiement: 'especes', categorie: 'apport_caisse', motif: 'Apport initial caisse', date_transaction: jour(-42) },
    { type: 'sortie', montant: 3_500_000, mode_paiement: 'mobile_money', categorie: 'achat_materiaux', motif: 'Achat ciment et fer à béton', chantier_id: palmeraie.id, date_transaction: jour(-40) },
    { type: 'sortie', montant: 1_250_000, mode_paiement: 'especes', categorie: 'main_d_oeuvre', motif: 'Paiement hebdomadaire des tâcherons', chantier_id: palmeraie.id, date_transaction: jour(-29) },
    { type: 'sortie', montant: 480_000, mode_paiement: 'especes', categorie: 'carburant', motif: 'Gasoil camion benne', date_transaction: jour(-23) },
    { type: 'entree', montant: 6_000_000, mode_paiement: 'mobile_money', categorie: 'apport_caisse', motif: 'Acompte versé par Ets Camara', chantier_id: kipe.id, date_transaction: jour(-20) },
    { type: 'sortie', montant: 850_000, mode_paiement: 'mobile_money', categorie: 'transport', motif: 'Location camion pour livraison', chantier_id: kipe.id, date_transaction: jour(-18) },
  ];
  for (const operation of operations) {
    await publier(url, '/api/caisse/transactions', operation);
  }

  /* --- Factures : une partiellement réglée, une en attente ---------------- */
  const facturePalmeraie = await publier(url, '/api/factures', {
    chantier_id: palmeraie.id,
    date_emission: jour(-20),
    date_echeance: jour(10),
    lignes: [
      { designation: 'Fondations et élévation gros œuvre', quantite: 1, prix_unitaire: 9_500_000 },
      { designation: 'Fourniture et pose de la charpente', quantite: 1, prix_unitaire: 2_000_000 },
      { designation: 'Journées de maçonnerie', quantite: 10, prix_unitaire: 100_000 },
    ],
  });
  const acompte = await publier(url, `/api/factures/${facturePalmeraie.id}/reglements`, {
    montant: 5_000_000,
    mode_paiement: 'virement',
    date_reglement: jour(-8),
    reference: 'Virement bancaire n° 4471',
  });

  const factureKipe = await publier(url, '/api/factures', {
    chantier_id: kipe.id,
    date_emission: jour(-100),
    date_echeance: jour(-70),
    lignes: [
      { designation: 'Travaux de finition et peinture', quantite: 1, prix_unitaire: 4_800_000 },
    ],
  });

  return {
    clients: [kaba.nom, camara.nom],
    chantiers: [`${palmeraie.nom} (${palmeraie.statut})`, `${kipe.nom} (${kipe.statut})`],
    articles: catalogue.length,
    mouvements_stock: mouvements,
    transactions_caisse: operations.length + 1, // + le règlement, imputé automatiquement
    factures: [
      `${facturePalmeraie.numero} — ${acompte.statut} (${acompte.montant_regle} réglés sur ${acompte.montant_total})`,
      `${factureKipe.numero} — ${factureKipe.statut}`,
    ],
  };
}

/** Supprime la base existante (fichier + journaux WAL) pour repartir de zéro. */
function effacerBase(dbPath) {
  for (const suffixe of ['', '-wal', '-shm']) {
    const chemin = `${dbPath}${suffixe}`;
    if (fs.existsSync(chemin)) {
      fs.rmSync(chemin);
      console.log(`Base existante supprimée : ${chemin}`);
    }
  }
}

/**
 * Recrée la base `DB_PATH` et l'alimente. Renvoie `{ chemin, resume }`.
 *
 * Le serveur est démarré sur le port 0 (attribué par l'OS) : `npm run seed` ne
 * peut donc pas entrer en conflit avec un `npm start` déjà lancé.
 */
export async function main({ dbPath = resolveDbPath() } = {}) {
  const chemin = path.resolve(dbPath);
  effacerBase(chemin);

  const instance = startServer({ port: 0, dbPath: chemin });
  try {
    if (!instance.server.listening) await once(instance.server, 'listening');
    const resume = await remplirBase(instance.url);
    return { chemin, resume };
  } finally {
    await instance.close();
  }
}

/** Vrai quand ce module est le point d'entrée (`node scripts/seed.js`). */
function estModulePrincipal() {
  const entree = process.argv[1];
  return Boolean(entree) && import.meta.url === pathToFileURL(entree).href;
}

if (estModulePrincipal()) {
  main()
    .then(({ chemin, resume }) => {
      console.log(`\nBase de démonstration prête : ${chemin}`);
      console.log(`Devise affichée (CURRENCY_SYMBOL) : ${resolveCurrencySymbol()}`);
      for (const [cle, valeur] of Object.entries(resume)) {
        const details = Array.isArray(valeur) ? valeur.join(' | ') : valeur;
        console.log(`  ${cle} : ${details}`);
      }
      console.log('\nPour consulter : npm start');
    })
    .catch((erreur) => {
      console.error(`Échec du remplissage : ${erreur.message}`);
      process.exitCode = 1;
    });
}
