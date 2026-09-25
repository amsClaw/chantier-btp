# Chantier BTP — gestion de chantier pour une PME

Application web **mobile-first**, locale et autonome (Node.js 22 + Express + SQLite),
pour un chef de chantier ou un gérant de PME BTP : suivre en direct depuis un
téléphone ce qui entre, ce qui sort et ce qui est facturé. Aucun compte, aucun
service externe, aucune connexion internet obligatoire.

Produit de l'usine logicielle. Spécification : `docs/SPEC.md`, décisions d'Ams :
`docs/DECISIONS.md`, histoires : `docs/HISTOIRES.md`.

## Les trois piliers

| Pilier | Ce qu'il fait | Écran |
| --- | --- | --- |
| **Stock** | Catalogue de matériaux et consommables BTP (ciment, fer à béton, sable, gravier, parpaings, gasoil…), approvisionnements, sorties **imputées obligatoirement à un chantier**, stock restant recalculé en temps réel, alerte sous le seuil | onglet **Stock** |
| **Caisse** | Journal des entrées et sorties d'argent (espèces, mobile money, virement, chèque) avec motif, catégorie et chantier ; **solde net affiché en gros** en haut de page = total entrées − total sorties | onglet **Caisse** |
| **Facturation** | Facture rattachée à un chantier et un client, lignes de prestation, numéro `FAC-AAAA-NNNN`, règlements (acomptes, situations, soldes), reste à payer et statut (`en_attente`, `partielle`, `soldee`) calculés automatiquement, **vue imprimable A4** | onglet **Factures** |

Un encaissement enregistré sur une facture alimente automatiquement le journal de
caisse (motif « Règlement Facture [Numéro] - [Client] ») : pas de double saisie.

## Prérequis

- **Node.js 22** (testé sur Node.js 22.23). `npm` est fourni avec Node.
- Deux dépendances seulement, installées par `npm install` : `express` et
  `better-sqlite3` (base SQLite, incluse dans le projet — aucun serveur de base à
  installer).
- Un navigateur récent sur le téléphone. Aucun accès réseau sortant n'est utilisé
  par l'application.

## Démarrage rapide

```bash
npm install     # installe express + better-sqlite3
npm test        # suite de tests (runner natif node --test)
npm run seed    # crée une base de démonstration réaliste (facultatif)
npm start       # démarre le serveur sur http://localhost:8080
```

Puis ouvrir `http://<ip-du-poste>:8080` dans le navigateur du téléphone.
La base est créée automatiquement au premier démarrage.

> `npm run seed` **efface** le fichier SQLite désigné par `DB_PATH` avant de le
> remplir : arrêtez le serveur (`Ctrl+C`) avant de le lancer sur une base en usage.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `8080` | port d'écoute HTTP |
| `DB_PATH` | `./data/chantier.sqlite` | fichier SQLite (créé avec ses dossiers parents) |
| `CURRENCY_SYMBOL` | `GNF` | symbole monétaire affiché, décision d'Ams du 2026-09-25 (franc guinéen) |

Aucun chemin absolu n'est codé en dur : les valeurs par défaut sont relatives au
répertoire de lancement, l'application s'installe donc n'importe où.

```bash
# Démonstration avec configuration personnalisée
DB_PATH=/tmp/demo-chantier.sqlite PORT=9000 CURRENCY_SYMBOL=GNF npm start
curl -s http://localhost:9000/health          # {"status":"ok"}
curl -s http://localhost:9000/api/config      # {"produit":"chantier-btp","currency_symbol":"GNF"}

# Bascule instantanée en euros, sans toucher au code
PORT=9100 CURRENCY_SYMBOL=€ npm start
curl -s http://localhost:9100/api/config      # {"produit":"chantier-btp","currency_symbol":"€"}
```

La devise est interpolée dans la page d'accueil (bandeau supérieur, élément
`#devise-app`) **et** renvoyée par `GET /api/config`, que l'interface lit au
démarrage : tout l'affichage des montants suit `CURRENCY_SYMBOL`. Les montants
restent des entiers (pas de centimes).

## Jeu de données de démonstration

`npm run seed` démarre un serveur temporaire sur un port libre et alimente une base
propre **par l'API publique** : les règles métier (numérotation des factures,
imputation des règlements en caisse, contrôle du stock disponible) restent celles du
produit, les données de démo sont donc exactement ce que produirait la saisie.

Contenu créé (2 clients, 2 chantiers dont un terminé, 6 matériaux, caisse variée,
2 factures dont une partiellement réglée) — sortie réelle de la commande :

```
Base de démonstration prête : ./data/chantier.sqlite
Devise affichée (CURRENCY_SYMBOL) : GNF
  clients : Société Immobilière Kaba | Ets Camara & Fils
  chantiers : Résidence Palmeraie (en_cours) | Villa Kipé (termine)
  articles : 6
  mouvements_stock : 15
  transactions_caisse : 7
  factures : FAC-2026-0001 — partielle (5000000 réglés sur 12500000) | FAC-2026-0002 — en_attente
```

État consultable ensuite via `npm start` (relevé réel sur la base de démo) :

- solde de caisse : `{"solde":16920000,"total_entrees":23000000,"total_sorties":6080000}`
- stock : Ciment 160 sacs, Fer à béton 140 barres, Sable 28 m³, Gravier 21 m³,
  Parpaings 750 pièces, Gasoil 180 litres
- factures : `FAC-2026-0001` partielle, 12 500 000 au total, 7 500 000 restant à
  payer · `FAC-2026-0002` en attente, 4 800 000
- journal de caisse : 7 lignes, dont le règlement de 5 000 000 par virement
  (entrée 5 000 000, motif « Règlement Facture FAC-2026-0001 - Société Immobilière Kaba »)

## Utilisation sur mobile

1. Se connecter au même réseau que le poste qui fait tourner le serveur.
2. Ouvrir `http://<ip-du-poste>:8080` ; ajouter la page à l'écran d'accueil.
3. **Chantiers** : « + Nouveau chantier » permet de créer le client au passage.
   Le bouton « Consommations & dépenses » déroule le détail d'un chantier ;
   « Clôturer » passe le chantier en *terminé* (aucune donnée n'est supprimée).
4. **Stock** : « + Approvisionner » pour une entrée, « + Sortie chantier » pour une
   consommation (le chantier est alors obligatoire). Le stock restant et l'alerte de
   seuil se mettent à jour sans recharger la page.
5. **Caisse** : « + Entrée » / « − Sortie ». Le solde net est recalculé à chaque
   opération, en haut de l'écran.
6. **Factures** : « + Nouvelle facture » (une ou plusieurs lignes), puis
   « Encaisser un règlement » (des acomptes successifs sont possibles). Le bouton
   « Imprimer / PDF » ouvre la boîte d'impression du navigateur : la vue facture est
   mise en page pour un A4 propre (navigation et boutons masqués via `@media print`).
7. Ergonomie : cibles tactiles ≥ 44 px, champs numériques avec pavé `inputmode="numeric"`,
   aucun défilement horizontal en 375 × 667 px (iPhone SE).

## Sauvegarde

Toutes les données tiennent dans le fichier SQLite de `DB_PATH` : arrêter le serveur
et copier ce fichier suffit. Pour restaurer, remettre le fichier en place et redémarrer.

## API HTTP (résumé)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/health` | état du service — répond toujours `200 {"status":"ok"}` |
| GET | `/api/config` | configuration publique (devise de l'instance) |
| GET/POST | `/api/clients` | lister / créer un client |
| GET/POST | `/api/chantiers` | lister (`?statut=en_cours` ou `termine`) / créer un chantier |
| GET/PATCH | `/api/chantiers/:id` | détail / modifier (dont clôture `statut: "termine"`) |
| GET | `/api/chantiers/:id/consommations` | sorties de stock du chantier |
| GET/POST | `/api/articles` | catalogue des matériaux et stock restant |
| POST | `/api/stock/mouvements` | approvisionnement (`entree`) ou sortie chantier (`sortie`) |
| GET | `/api/caisse/solde` | solde net, total des entrées et des sorties |
| GET/POST | `/api/caisse/transactions` | journal (filtrable `?chantier_id=`) / saisie |
| GET/POST | `/api/factures` | liste avec reste à payer / émission d'une facture |
| GET | `/api/factures/:id` | facture détaillée (lignes + règlements) |
| POST | `/api/factures/:id/reglements` | encaisser un règlement (imputé en caisse) |

## Recette — scénarios holdout

Les scénarios de `docs/SPEC.md` sont rejoués automatiquement contre le vrai serveur
(`test/recette.test.js`). Résultats observés, sur base vierge :

| Scénario holdout | Résultat attendu | Résultat observé |
| --- | --- | --- |
| **1. Cycle complet** — client « Société Immobilière Kaba », chantier « Résidence Palmeraie », entrées 200 sacs de ciment + 100 barres, sorties 80 sacs + 40 barres, entrée de caisse 3 000 000, sortie 450 000, facture 2 500 000, acompte 1 000 000 | stock 120 sacs / 60 barres ; fiche chantier = 80 sacs + 40 barres ; solde de caisse 3 550 000 ; facture 2 500 000 / réglé 1 000 000 / reste 1 500 000 / `partielle` ; ligne de caisse automatique de 1 000 000 | **conforme** — stock `Ciment 120`, `Fer à béton 12 mm 60` ; consommations `[Ciment 80, Fer à béton 12 mm 40]` ; `{"solde":3550000,"total_entrees":4000000,"total_sorties":450000}` ; facture `partielle`, reste `1500000` ; journal : 1 entrée de 1 000 000, motif « Règlement Facture FAC-2026-0001 - Société Immobilière Kaba » |
| **2. Mobile & persistance** — affichage 375 px, cibles ≥ 44 px, redémarrage du serveur avec le même `DB_PATH` | aucun défilement horizontal ; boutons, onglets et champs ≥ 44 × 44 px ; données intactes après arrêt et relance | **conforme** — `overflow-x: clip`, `--cible: 44px` appliqué à `.bouton`, `.onglet` et aux champs (contrôle structurel du CSS livré) ; après arrêt puis relance sur le même `DB_PATH`, solde, facture (reste `1500000`), consommations (2 lignes), clients et articles sont restitués à l'identique |
| **3. Robustesse** — sortie de 500 sacs pour 120 disponibles, montants de caisse `-50000` et `0`, règlement de 2 000 000 pour 1 500 000 dus, `GET /api/chantiers/99999` et `/api/factures/99999` | refusés en `400` (stock intact), `404` sur identifiant inconnu, `GET /health` toujours `200` | **conforme** — `400 {"error":"Stock insuffisant","stock_actuel":120}` et stock resté à 120 ; montants invalides refusés en `400` ; `400 {"error":"Le montant dépasse le reste à payer"}` ; `404` sur les deux identifiants, puis `/health` `200 {"status":"ok"}` |

## Tests

```bash
npm test          # node --test : 77 tests, 0 échec
```

- `test/health.test.js`, `test/db.test.js` — démarrage, `/health`, base SQLite auto-créée.
- `test/chantiers.test.js`, `test/stock.test.js`, `test/caisse.test.js`,
  `test/factures.test.js` — API par domaine et valeurs métier exactes.
- `test/ui.test.js` — page unique servie, 4 onglets, cibles 44 px, règle d'impression,
  échappement HTML, formatage des montants.
- `test/config.test.js` — `CURRENCY_SYMBOL` (défaut, substitution dans la page,
  `/api/config`), `PORT`, `DB_PATH`, absence de chemin absolu dans les sources.
- `test/errors.test.js` — `400` JSON sur saisie malformée, `404` JSON sur route
  inconnue, `500` JSON sans fuite technique ni arrêt du processus.
- `test/seed.test.js` — contenu de la base de démonstration, ré-exécution « base propre ».
- `test/recette.test.js` — les trois scénarios holdout ci-dessus.

## Robustesse

- Toutes les saisies sont validées côté serveur : montants négatifs ou nuls, quantités
  non entières, sortie de stock supérieure au disponible, surpaiement d'une facture
  sont refusés en `400` avec un message explicite.
- Un middleware d'erreur global renvoie un JSON d'erreur propre : aucune exception
  inattendue n'arrête le processus Node.js, le détail technique reste dans le journal
  du serveur et `GET /health` répond toujours `200`.
- Les routes API inconnues répondent `404` en JSON.

## Limites assumées (hors périmètre v1)

- Pas d'authentification : à exposer uniquement sur le réseau local du bureau ou du
  chantier (une protection éventuelle se ferait en amont, reverse proxy ou VPN).
- Une seule devise par instance (`CURRENCY_SYMBOL`), montants entiers sans centimes.
- Pas de passerelle de paiement mobile money : les encaissements sont saisis
  manuellement. Pas de comptabilité en partie double, pas de module RH.
