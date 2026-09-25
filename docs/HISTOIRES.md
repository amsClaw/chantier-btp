# HISTOIRES — Gestion de chantier BTP

Découpage en 7 histoires de 1 à 4 heures chacune, à réaliser dans l'ordre strict. Chaque histoire respecte les plafonds imposés (≤ 500 lignes par fichier, ≤ 1500 lignes au total, ≤ 20 fichiers).

---

## Histoire 1 — Squelette serveur, initialisation SQLite et endpoint de santé

**Titre :** Initialiser le projet Node.js/Express avec SQLite (`better-sqlite3`), contrat `GET /health` et premier test passant.

**Complexité :** simple

**Critères d'acceptation :**
1. `package.json` configuré avec `"type": "module"` (ou CommonJS homogène), dépendances de production limitées strictement à `express` et `better-sqlite3`, scripts `start` (`node src/server.js`) et `test` (`node --test`).
2. `src/server.js` démarre et écoute sur `process.env.PORT || 8080`.
3. Initialisation de la base SQLite au chemin `process.env.DB_PATH || './data/chantier.sqlite'`. Si le répertoire parent n'existe pas, il est créé automatiquement au démarrage (`fs.mkdirSync(..., { recursive: true })`).
4. Endpoint `GET /health` répondant le statut HTTP 200 et le payload JSON `{ "status": "ok" }`.
5. `test/health.test.js` utilisant le runner de test natif de Node.js (`node:test` et `node:assert`) qui démarre le serveur sur un port temporaire et valide la réponse 200 de `GET /health`.
6. La commande `npm test` s'exécute avec succès en CLI, sans réseau, et rapporte au moins un test réussi avec zéro échec.

**Ne touche pas :** tables métier (chantiers, stocks, caisse, factures), interface HTML/CSS, logique métier.

**Résultat visible :** Sortie terminal de `npm test` verte, et `curl http://localhost:8080/health` renvoyant `{"status":"ok"}` après `npm start`.

---

## Histoire 2 — API et persistance des Chantiers et Clients

**Titre :** Modèle SQLite et routes API pour la gestion des clients et des chantiers (création, consultation, clôture).

**Complexité :** simple

**Critères d'acceptation :**
1. Création des tables SQLite au démarrage :
   - `clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, telephone TEXT, adresse TEXT, created_at INTEGER NOT NULL)`
   - `chantiers (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id), nom TEXT NOT NULL, lieu TEXT, statut TEXT DEFAULT 'en_cours', date_debut TEXT, created_at INTEGER NOT NULL)`
2. Routes API fonctionnelles :
   - `GET /api/clients` : retourne la liste de tous les clients.
   - `POST /api/clients` : crée un client (champs `nom`, `telephone`, `adresse`).
   - `GET /api/chantiers` : liste les chantiers avec le nom du client associé ; accepte le paramètre optionnel `?statut=en_cours` ou `?statut=termine`.
   - `POST /api/chantiers` : crée un chantier lié à un `client_id` existant (renvoie 400 si `client_id` ou `nom` manquant).
   - `GET /api/chantiers/:id` : retourne le détail du chantier avec les données du client (renvoie 404 si inexistant).
   - `PATCH /api/chantiers/:id` : permet de modifier le statut (`en_cours` ou `termine`) et les détails du chantier.
3. Tests d'intégration automatisés dans `test/chantiers.test.js` :
   - Création d'un client et création d'un chantier rattaché.
   - Filtrage des chantiers par statut.
   - Clôture d'un chantier (`PATCH` vers `statut: 'termine'`).
   - Requête sur un identifiant de chantier inconnu renvoyant bien une erreur HTTP 404.
4. `npm test` toujours vert avec l'ensemble des tests collectés (≥ 4 tests au total).

**Ne touche pas :** stocks, caisse, facturation, interface graphique utilisateur.

**Résultat visible :** Tests d'intégration verts confirmant les créations et modifications de chantiers en base SQLite via requêtes HTTP.

---

## Histoire 3 — API et gestion des Stocks (Articles et Mouvements)

**Titre :** Catalogue de matériaux et consommables, enregistrement des entrées/sorties et calcul du stock disponible en temps réel.

**Complexité :** standard

**Critères d'acceptation :**
1. Création des tables SQLite au démarrage :
   - `articles (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, unite TEXT NOT NULL, seuil_alerte INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`
   - `mouvements_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id), chantier_id INTEGER REFERENCES chantiers(id), type TEXT NOT NULL CHECK(type IN ('entree', 'sortie')), quantite INTEGER NOT NULL CHECK(quantite > 0), date_mouvement TEXT NOT NULL, motif TEXT, created_at INTEGER NOT NULL)`
2. Routes API fonctionnelles :
   - `GET /api/articles` : liste des articles avec calcul dynamique du stock disponible (`stock_actuel = total_entrees - total_sorties`).
   - `POST /api/articles` : création d'un article (`nom`, `unite` parmi sac, barre, m3, tonne, litre, piece, etc.).
   - `POST /api/stock/mouvements` : enregistrement d'un mouvement.
     - Pour une `entree` (approvisionnement) : `article_id`, `quantite`, `date_mouvement`, `motif` optionnel (`chantier_id` facultatif).
     - Pour une `sortie` (consommation terrain) : `article_id`, `quantite`, `date_mouvement`, `chantier_id` **obligatoire** (renvoie 400 si `chantier_id` absent).
   - `GET /api/chantiers/:id/consommations` : détail de tous les matériaux consommés (sorties de stock) pour ce chantier spécifique.
3. Règle métier bloquante : refus d'une sortie de stock si la quantité demandée est strictement supérieure au stock disponible actuel de l'article (renvoie HTTP 400 `{ "error": "Stock insuffisant" }` avec le stock actuel indiqué).
4. Tests d'intégration dans `test/stock.test.js` :
   - Création d'un article (ex: Ciment en sacs).
   - Approvisionnement de 100 sacs -> stock = 100.
   - Sortie de 30 sacs affectée à un chantier -> stock disponible = 70, et consommation bien listée sur le chantier.
   - Tentative de sortie de 80 sacs -> refusée (HTTP 400), stock inchangé à 70.
5. `npm test` vert avec ≥ 7 tests collectés au total.

**Ne touche pas :** journal de caisse, facturation, interface graphique utilisateur.

**Résultat visible :** Tests automatisés verts validant le calcul exact du stock disponible et la ventilation des consommations par chantier.

---

## Histoire 4 — API et Journal de Caisse

**Titre :** Enregistrement des flux financiers terrain (entrées/sorties de caisse) et calcul instantané du solde net.

**Complexité :** standard

**Critères d'acceptation :**
1. Création de la table SQLite au démarrage :
   - `transactions_caisse (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('entree', 'sortie')), montant INTEGER NOT NULL CHECK(montant > 0), mode_paiement TEXT NOT NULL CHECK(mode_paiement IN ('especes', 'mobile_money', 'virement', 'cheque')), categorie TEXT NOT NULL, motif TEXT NOT NULL, chantier_id INTEGER REFERENCES chantiers(id), date_transaction TEXT NOT NULL, created_at INTEGER NOT NULL)`
2. Routes API fonctionnelles :
   - `GET /api/caisse/solde` : retourne `{ solde: number, total_entrees: number, total_sorties: number }` calculé directement depuis les enregistrements de la table.
   - `GET /api/caisse/transactions` : liste chronologique inversée (les opérations les plus récentes d'abord), acceptant le paramètre de filtrage optionnel `?chantier_id=...`.
   - `POST /api/caisse/transactions` : enregistrement d'une entrée ou d'une sortie (validation stricte : `montant > 0`, `type` et `mode_paiement` conformes, `motif` non vide).
3. Gestion des catégories courantes de chantier : `'achat_materiaux'`, `'main_d_oeuvre'`, `'carburant'`, `'transport'`, `'apport_caisse'`, `'reglement_client'`, `'divers'`.
4. Tests d'intégration dans `test/caisse.test.js` :
   - Enregistrement d'une entrée d'espèces de 500 000 FCFA.
   - Enregistrement d'une sortie Mobile Money de 150 000 FCFA rattachée à un chantier.
   - Vérification du solde net retourné par `GET /api/caisse/solde` égal exactement à 350 000 FCFA.
   - Rejet (HTTP 400) en cas de montant négatif ou de paramètres invalides.
5. `npm test` vert avec ≥ 10 tests collectés au total.

**Ne touche pas :** facturation, interface utilisateur.

**Résultat visible :** Tests d'intégration verts démontrant la conformité du journal de caisse et l'exactitude mathématique du solde en temps réel.

---

## Histoire 5 — API Facturation, Lignes et Règlements clients

**Titre :** Émission des factures de chantier, décompte des règlements partiels/totaux et alimentation automatique de la caisse.

**Complexité :** standard

**Critères d'acceptation :**
1. Création des tables SQLite au démarrage :
   - `factures (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT UNIQUE NOT NULL, chantier_id INTEGER NOT NULL REFERENCES chantiers(id), date_emission TEXT NOT NULL, date_echeance TEXT, statut TEXT DEFAULT 'en_attente' CHECK(statut IN ('en_attente', 'partielle', 'soldee')), created_at INTEGER NOT NULL)`
   - `lignes_facture (id INTEGER PRIMARY KEY AUTOINCREMENT, facture_id INTEGER NOT NULL REFERENCES factures(id), designation TEXT NOT NULL, quantite INTEGER NOT NULL CHECK(quantite > 0), prix_unitaire INTEGER NOT NULL CHECK(prix_unitaire >= 0), total_ligne INTEGER NOT NULL)`
   - `reglements_facture (id INTEGER PRIMARY KEY AUTOINCREMENT, facture_id INTEGER NOT NULL REFERENCES factures(id), montant INTEGER NOT NULL CHECK(montant > 0), mode_paiement TEXT NOT NULL, date_reglement TEXT NOT NULL, reference TEXT, transaction_caisse_id INTEGER REFERENCES transactions_caisse(id), created_at INTEGER NOT NULL)`
2. Routes API fonctionnelles :
   - `GET /api/factures` : liste de toutes les factures avec montant total calculé, montant déjà réglé, reste à payer et statut.
   - `POST /api/factures` : création d'une facture liée à un chantier, avec génération automatique d'un numéro lisible séquentiel (ex. `FAC-2026-0001`) et insertion atomique de ses lignes de détail.
   - `GET /api/factures/:id` : détail complet d'une facture (client, chantier, lignes de prestation, total, règlements perçus, reste à payer).
   - `POST /api/factures/:id/reglements` : enregistrement d'un règlement.
3. Règles métier strictes :
   - Tout règlement enregistré crée **automatiquement** dans la même transaction SQLite une entrée dans `transactions_caisse` (`type: 'entree'`, `categorie: 'reglement_client'`, `motif: 'Règlement Facture [numero] - [Nom Client]'`, `chantier_id: facture.chantier_id`).
   - Le statut de la facture est recalculé automatiquement : `en_attente` (0 réglé), `partielle` (réglé < total), `soldee` (réglé >= total).
   - Tout règlement dont le montant dépasse le reste à payer est rejeté avec HTTP 400 (`{ "error": "Le montant dépasse le reste à payer" }`).
4. Tests d'intégration dans `test/factures.test.js` :
   - Création d'une facture de 1 000 000 FCFA avec 2 lignes.
   - Enregistrement d'un acompte de 400 000 FCFA -> statut `partielle`, reste à payer = 600 000 FCFA, et vérification qu'une entrée de 400 000 FCFA est bien insérée dans `transactions_caisse`.
   - Enregistrement du solde de 600 000 FCFA -> statut `soldee`, reste à payer = 0.
   - Tentative de règlement supplémentaire -> rejetée (HTTP 400).
5. `npm test` vert avec ≥ 14 tests collectés au total.

**Ne touche pas :** interface utilisateur HTML/CSS.

**Résultat visible :** Tests d'intégration verts validant l'ensemble du cycle de facturation et l'imputation sans double saisie dans la trésorerie.

---

## Histoire 6 — Interface Mobile-First intégrée et Navigation tactile

**Titre :** Interface web mobile-first responsive (HTML/CSS/JS natif) avec navigation par onglets (Chantiers, Stock, Caisse, Factures) et saisie tactile rapide.

**Complexité :** standard

**Critères d'acceptation :**
1. L'application sert une page unique d'accueil complète sur `GET /` sans bundler, utilisant HTML sémantique, CSS moderne et JavaScript natif vanilla.
2. Barre de navigation intuitive adaptée au smartphone (bandeau supérieur clair + barre d'onglets persistante) permettant de basculer instantanément sans rechargement lourd entre 4 vues :
   - **Chantiers :** liste des chantiers avec statut en badge (`En cours` / `Terminé`), bouton d'ajout « + Nouveau chantier », et panneau déroulant affichant les consommations de matériaux et les dépenses associées.
   - **Stock :** tableau de bord des matériaux avec niveau de stock disponible et indicateur coloré, bouton « + Approvisionner » (entrée) et bouton « + Sortie chantier » (consommation affectée à un chantier).
   - **Caisse :** affichage proéminent en tête de page du solde net disponible en gros caractères, deux boutons d'action rapide contrastés (« + Entrée », « − Sortie »), et liste chronologique des dernières opérations.
   - **Factures :** liste des factures avec montants, badges de statut (`En attente`, `Partielle`, `Soldée`), bouton « + Nouvelle facture » et bouton rapide « Encaisser un règlement ».
3. Vue détail et impression de facture :
   - Affichage propre de la facture sélectionnée avec bouton « Imprimer / PDF ».
   - Feuille de style intégrant `@media print` qui masque la navigation, les boutons d'action et les ombres, pour produire une facture A4 impeccable adaptée à la remise au client.
4. Contraintes ergonomiques mobiles :
   - Cibles tactiles (boutons, onglets, sélecteurs) d'une dimension minimale de 44×44 px dans le CSS.
   - Champs de saisie numérique utilisant `<input type="number">` pour ouvrir automatiquement le pavé numérique sur smartphone.
   - Zéro défilement horizontal sur viewport mobile 375×667 px (vérifié par `scrollWidth === clientWidth`).
5. Les interactions dans l'interface (ajouts, saisies de mouvements, règlements) appellent les routes API correspondantes et mettent à jour les indicateurs à l'écran sans recharger la page.
6. Aucune régression sur la suite de tests automatisés `npm test`.

**Ne touche pas :** modification des règles métier serveur (déjà stabilisées).

**Résultat visible :** Inspection du rendu sur viewport 375×667 px confirmant l'ergonomie mobile, l'absence de débordement horizontal, des boutons d'au moins 44 px, et une navigation réactive entre les 4 onglets.

---

## Histoire 7 — Paramètres d'environnement, jeu de données démo, robustesse et README

**Titre :** Configuration par variables d'environnement (`PORT`, `DB_PATH`, `CURRENCY_SYMBOL`), script seed démo, gestion globale des erreurs et documentation de déploiement.

**Complexité :** simple

**Critères d'acceptation :**
1. Prise en compte de la variable `process.env.CURRENCY_SYMBOL` (valeur par défaut `'GNF'` — franc guinéen, décision d'Ams du 2026-09-25), interpolée dynamiquement dans l'UI et renvoyée par un endpoint de configuration simple ou injectée dans la page d'accueil (permettant de basculer instantanément en `GNF` ou `€`).
2. Prise en compte rigoureuse de `PORT` et `DB_PATH` sans aucun chemin absolu codé en dur dans tout le projet (une recherche des dossiers utilisateurs `Users` et `home` dans les sources ne retourne aucune occurrence).
3. Script d'injection de données de démonstration : `npm run seed` qui peuple une base propre avec un jeu de données réaliste pour une PME BTP (2 clients, 2 chantiers dont 1 en cours et 1 terminé, 6 articles de matériaux usuels, approvisionnements et sorties de stock, transactions de caisse variées espèces/mobile money, et 2 factures dont 1 partiellement réglée).
4. Middleware de capture d'erreur globale Express renvoyant un JSON d'erreur propre en cas d'exception inattendue, garantissant que le serveur ne crash jamais et que `GET /health` répond toujours HTTP 200.
5. Fichier `README.md` exhaustif contenant :
   - Présentation de l'application et de ses 3 piliers (Stock, Caisse, Facturation).
   - Prérequis (Node.js 22).
   - Commandes de démarrage : `npm install`, `npm test`, `npm run seed`, `npm start`.
   - Variables d'environnement supportées (`PORT`, `DB_PATH`, `CURRENCY_SYMBOL`).
   - Guide d'utilisation rapide sur mobile.
   - Tableau de recette récapitulant les résultats observés pour les 3 scénarios holdout de la spécification.
6. La suite complète `npm test` s'exécute et passe avec 100% de réussite.

**Ne touche pas :** altération des tables SQLite déjà validées.

**Résultat visible :** `README.md` complet, suite `npm test` verte, et serveur capable d'être démarré avec une configuration personnalisée (`PORT=9000 CURRENCY_SYMBOL=GNF npm start`) en chargeant des données de test via `npm run seed`.

---

## Histoire 8 — Correction et annulation de saisie avec piste d'audit

**Titre :** Permettre d'annuler un mouvement de stock ou une opération de caisse, et de corriger une ligne de facture non réglée, sans jamais perdre la saisie d'origine ni casser les soldes déjà validés.

**Contexte (décision d'Ams, 2026-09-25) :** aucune saisie n'est aujourd'hui corrigible ni supprimable ; une erreur de frappe (ex. prix unitaire erroné) est bloquante. Voir `docs/DECISIONS.md`. **Cette histoire touche la correction de données financières déjà émises (liste 2 de `docs/contrats/POLICY.md`) : la fusion en production attend la validation explicite d'Ams après revue du juge — pas d'auto-merge.**

**Complexité :** standard

**Critères d'acceptation :**
1. Nouvelle table SQLite au démarrage, commune aux trois domaines :
   - `historique_saisies (id INTEGER PRIMARY KEY AUTOINCREMENT, domaine TEXT NOT NULL CHECK(domaine IN ('stock', 'caisse', 'facture')), reference_id INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('annulation', 'correction')), motif TEXT NOT NULL, valeur_avant TEXT NOT NULL, valeur_apres TEXT, created_at INTEGER NOT NULL)`
   - `valeur_avant` / `valeur_apres` : snapshot JSON de la ligne concernée avant/après l'opération.
2. **Stock — annulation, jamais de suppression :**
   - `POST /api/stock/mouvements/:id/annuler` avec `{ motif }` (obligatoire, HTTP 400 sinon).
   - Crée un **nouveau mouvement compensatoire** (même article, même chantier, même quantité, type inversé), ajoute une colonne `mouvements_stock.annule_par_id INTEGER REFERENCES mouvements_stock(id)` pour lier l'original à sa compensation.
   - Refuse (HTTP 400) d'annuler un mouvement déjà annulé, ou un mouvement compensatoire lui-même.
   - Écrit une ligne dans `historique_saisies` (`domaine: 'stock'`, `action: 'annulation'`).
   - Le mouvement d'origine reste visible tel quel dans `GET /api/articles/:id/mouvements` (ou équivalent existant), avec son statut d'annulation.
3. **Caisse — annulation, jamais de suppression :**
   - `POST /api/caisse/transactions/:id/annuler` avec `{ motif }` (obligatoire).
   - Crée une **transaction compensatoire** (même montant, même chantier, type inversé), colonne `transactions_caisse.annule_par_id` pour le lien.
   - Refuse (HTTP 400, message explicite) d'annuler une transaction créée automatiquement par un règlement de facture (`transactions_caisse.id` référencé par `reglements_facture.transaction_caisse_id`) : ce cas n'est pas dans le périmètre de cette histoire.
   - Écrit une ligne dans `historique_saisies` (`domaine: 'caisse'`).
4. **Facture — correction de ligne, seulement avant tout règlement :**
   - `PATCH /api/factures/:id/lignes/:ligneId` avec `{ designation?, quantite?, prix_unitaire?, motif }` (`motif` obligatoire).
   - Autorisé **uniquement** si `montant_regle` de la facture est à 0 (aucun règlement perçu) ; sinon HTTP 409 avec message explicite invitant à une facture d'avoir/correctif plutôt qu'une modification (hors périmètre ici).
   - Recalcule `total_ligne` et le total de la facture.
   - Écrit une ligne dans `historique_saisies` (`domaine: 'facture'`, `action: 'correction'`, `valeur_avant`/`valeur_apres` = snapshot de la ligne).
5. `GET /api/historique/:domaine/:reference_id` : retourne l'historique des annulations/corrections pour une saisie donnée (utilisé par l'interface pour afficher qui a changé quoi et pourquoi).
6. Interface (Stock, Caisse, Factures) : chaque saisie annulable/corrigible affiche une action « Annuler » (stock, caisse) ou « Corriger » (ligne de facture non réglée) qui ouvre une boîte de dialogue **exigeant un motif** avant validation. Une saisie déjà annulée ou une facture réglée n'affiche plus cette action.
7. Tests d'intégration dans `test/audit.test.js` :
   - Annulation d'un mouvement de stock → stock revient à sa valeur d'avant, mouvement d'origine toujours listé, historique horodaté avec motif.
   - Tentative de double annulation du même mouvement → rejetée (HTTP 400).
   - Annulation d'une transaction de caisse → solde net revient à sa valeur d'avant.
   - Tentative d'annulation d'une transaction issue d'un règlement de facture → rejetée (HTTP 400).
   - Correction d'une ligne de facture non réglée → total recalculé, historique avant/après enregistré.
   - Tentative de correction d'une ligne sur une facture partiellement réglée → rejetée (HTTP 409).
8. `npm test` vert, aucune régression sur les histoires 1 à 7.

**Ne touche pas :** authentification, rôles/permissions (qui a le droit d'annuler n'est pas tranché par cette histoire — pour l'instant, comme le reste de l'app, tout accès au réseau local peut annuler/corriger), facture d'avoir formelle.

**Résultat visible :** dans l'interface, un mouvement de stock ou une opération de caisse erronés peuvent être annulés avec un motif, sans jamais disparaître de l'historique ; une ligne de facture peut être corrigée tant qu'aucun règlement n'a été perçu. `npm test` toujours vert.
