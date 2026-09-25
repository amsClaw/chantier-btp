# SPEC — Gestion de chantier BTP

## Résultat attendu (une phrase)
Une application web mobile-first locale et autonome (Node.js/Express + SQLite), sans compte ni service externe payant, permettant à un chef de chantier ou gérant de PME BTP en Afrique francophone de suivre en direct sur téléphone les stocks de matériaux, les entrées/sorties de caisse et la facturation client avec décompte des paiements.

---

## Exigences

1. **Stack technique autonome et sans service tiers payant : Node.js 22 + Express + SQLite (`better-sqlite3`).**
   L'application fonctionne entièrement en local sans connexion internet obligatoire, sans framework front lourd (React/Vue), sans bundler (Webpack/Vite) et sans dépendance externe payante (ni Twilio, ni Stripe, ni Firebase).
   *Critère observable :* Le fichier `package.json` liste uniquement `express` et `better-sqlite3` comme dépendances de production. Aucune dépendance de bundling ni framework SPA ; aucun appel réseau sortant lors de l'exécution.

2. **Contrat de démarrage et de santé dès l'histoire 1.**
   Le serveur démarre via `npm start` sur le port **8080** par défaut (surchargeable par la variable d'environnement `PORT`) et expose un endpoint de santé `GET /health` répondant le statut HTTP 200.
   *Critère observable :* L'exécution de `PORT=8080 npm start` suivie de `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health` renvoie exactement `200` ; l'exécution avec `PORT=9090 npm start` répond sur le port 9090.

3. **Harnais de test automatisé dès l'histoire 1.**
   La commande standard `npm test` exécute la suite de tests automatisés via le runner natif (`node --test`) sans nécessiter d'outils tiers, de navigateur ou d'accès réseau.
   *Critère observable :* `npm test` s'exécute en ligne de commande et rapporte au moins 1 test passant dès l'histoire 1, avec zéro échec.

4. **Gestion des chantiers et des clients.**
   L'application permet d'enregistrer des clients (nom, contact) et de créer des chantiers rattachés à un client (nom du chantier, lieu/adresse, date de début, statut `en_cours` ou `termine`). Un chantier peut être clôturé pour signifier la fin des travaux.
   *Critère observable :* Les clients et chantiers sont persistés dans les tables SQLite correspondantes (`clients`, `chantiers`) ; la liste des chantiers permet de distinguer immédiatement les chantiers en cours des chantiers terminés.

5. **Suivi des stocks de matériaux et consommables (entrées / sorties par chantier).**
   L'application gère un catalogue de matériaux et consommables usuels du BTP (ex. ciment, fer à béton, sable, gravier, parpaings, carburant) avec leurs unités de mesure (sac, barre, m3, tonne, litre, unité). Elle enregistre les mouvements d'approvisionnement (entrées) et les consommations (sorties affectées obligatoirement à un chantier). Elle calcule le stock restant disponible en temps réel.
   *Critère observable :* Après saisie d'une entrée de 100 sacs de ciment et d'une sortie de 35 sacs pour le chantier "Villa Kaba", la consultation du stock affiche un solde disponible de 65 sacs de ciment ; la fiche du chantier "Villa Kaba" liste exactement les 35 sacs consommés. Toute tentative de sortie d'une quantité supérieure au stock disponible est refusée avec une erreur 400 explicite.

6. **Journal de caisse opérationnel et solde net en temps réel.**
   L'application permet de consigner chaque flux d'argent liquide ou Mobile Money sur le terrain : Type (Entrée ou Sortie), Montant (entier positif), Date, Mode de paiement (Espèces, Mobile Money, Virement/Chèque), Motif/Catégorie (Achat matériaux, Main d'œuvre/Tâcherons, Carburant, Transport, Acompte client, Autre), et chantier rattaché (le cas échéant). L'écran de caisse affiche le solde net disponible (Total Entrées − Total Sorties) en gros caractères en haut de page.
   *Critère observable :* Le solde de caisse affiché correspond en permanence à `total_entrees - total_sorties` ; l'enregistrement d'une dépense de 150 000 FCFA déduit immédiatement ce montant du solde affiché sans nécessiter de rafraîchissement manuel complet.

7. **Facturation client, situations de travaux et suivi des règlements.**
   L'application permet d'émettre des factures rattachées à un chantier et un client, comprenant un numéro unique, une date d'émission, des lignes de prestations (désignation, quantité, prix unitaire, total ligne) et le total général. Elle permet d'enregistrer les règlements perçus (acomptes, situations, soldes). Le reste à payer (Total facture − Total règlements) et le statut de la facture (`en_attente`, `partielle`, `soldee`) sont calculés automatiquement.
   *Critère observable :* Pour une facture de 2 000 000 FCFA avec un acompte enregistré de 800 000 FCFA, le reste à payer affiche 1 200 000 FCFA et le statut est `partielle`. Dès qu'un règlement complémentaire de 1 200 000 FCFA est enregistré, le reste à payer passe à 0 et le statut devient `soldee`.

8. **Imputation automatique des règlements clients en caisse.**
   Tout encaissement enregistré au titre d'une facture alimente automatiquement le journal de caisse sous forme d'une Entrée avec le motif `"Règlement Facture [Numéro] - [Client]"`.
   *Critère observable :* L'enregistrement d'un règlement client de 500 000 FCFA sur une facture crée immédiatement et de manière vérifiable une transaction d'entrée de 500 000 FCFA dans la table `transactions_caisse`, augmentant le solde de caisse d'autant, sans double saisie.

9. **Vue facture imprimable et partageable (CSS print).**
   L'application intègre une vue détaillée de chaque facture spécialement formatée pour l'impression ou l'export PDF direct via le navigateur (règle CSS `@media print`), conforme aux usages commerciaux (en-tête entreprise, coordonnées client, détail du chantier, tableau des lots/prestations, récapitulatif des règlements perçus et net à payer restant).
   *Critère observable :* Lors du déclenchement de l'impression (`window.print()` ou Ctrl+P), la barre de navigation et les boutons d'action sont masqués (`display: none`), et le document tient sur une mise en page A4 lisible et contrastée.

10. **Ergonomie mobile-first, navigation guidée et cibles tactiles ≥ 44 px.**
    L'interface est conçue prioritairement pour une utilisation sur smartphone par un chef de chantier ou un gérant sur le terrain : navigation fluide entre 4 onglets principaux (Chantiers, Stock, Caisse, Factures), formulaires épurés avec pavé numérique automatique (`<input type="number">`) pour les montants et quantités, boutons contrastés et dimensionnés pour les doigts.
    *Critère observable :* Sur un viewport mobile de 375×667 px (iPhone SE), aucun défilement horizontal n'apparaît (`document.documentElement.scrollWidth === document.documentElement.clientWidth`) ; toutes les zones interactives (boutons, liens d'onglets, champs de sélection) mesurent au moins 44×44 px dans le CSS livré.

11. **Configuration par variables d'environnement et zéro chemin absolu.**
    Le port (`PORT`), le chemin du fichier de base de données (`DB_PATH`, valeur par défaut `./data/chantier.sqlite`) et le symbole monétaire (`CURRENCY_SYMBOL`, valeur par défaut `GNF` — franc guinéen) sont paramétrables par variables d'environnement.
    *Critère observable :* Lancer le serveur avec `DB_PATH=/tmp/test-chantier.sqlite PORT=8080 CURRENCY_SYMBOL=GNF npm start` crée la base au chemin indiqué et affiche les montants en `GNF` ; aucune chaîne contenant un chemin utilisateur local (ex. `/Users/...` ou `/home/...`) n'est codée en dur dans le code source.

12. **Robustesse face aux saisies invalides et aux erreurs.**
    L'application valide les données saisies côté serveur (rejet des montants négatifs, des quantités nulles, des formats incohérents). Les routes inexistantes renvoient une 404 propre et aucune erreur client ou requête malformée ne provoque l'arrêt du processus Node.js.
    *Critère observable :* L'envoi d'un corps JSON invalide ou d'une requête sur un identifiant inexistant renvoie un code HTTP 400 ou 404 approprié ; le endpoint `GET /health` continue de répondre HTTP 200 immédiatement après.

---

## Hors périmètre

- Comptes utilisateurs multiples avec système de permissions complexes (l'application est un outil autonome d'entreprise locale partagée sur le réseau du chantier ou du bureau).
- Passerelle de paiement en ligne automatique via API bancaires ou Mobile Money en ligne (Wave, Orange Money Web, MTN MoMo API) : les encaissements et décaissements Mobile Money sont consignés manuellement par l'utilisateur.
- Comptabilité générale formelle et bilan OHADA (pas d'écritures en partie double débit/crédit, pas de liasse fiscale).
- Module RH complet avec contrats de travail, fiches de paie et charges sociales (les paiements de main d'œuvre sont suivis comme dépenses de caisse au motif "Main d'œuvre / Tâcherons").
- Visualiseur de plans techniques ou modèles 3D/BIM (fichiers DXF, DWG ou IFC).
- Envoi automatique de SMS ou de messages WhatsApp via des services payants tiers (Twilio, etc.).
- Multi-devises simultané (la devise est uniforme pour l'instance de l'application via `CURRENCY_SYMBOL`).
- Déploiement distant effectif sur serveur de production (l'usine produit le logiciel testé et documenté, le déploiement sur VPS reste une opération d'infrastructure séparée).

---

## Hypothèses non prouvées

- **H1 :** La monnaie par défaut est le FRANC GUINÉEN (`CURRENCY_SYMBOL=GNF`) — décision d'Ams du 2026-09-25 — modifiable en `FCFA`, `€` ou toute autre devise via variable d'environnement, sans gestion de centimes (les montants manipulés dans les PME BTP de ces zones sont des entiers).
- **H2 :** L'accès à l'application s'effectue sans authentification par mot de passe pour maximiser la simplicité d'accès sur le terrain. Si une exposition sur internet public est requise, la sécurisation sera assurée en amont par un reverse proxy (ex. Nginx HTTP Basic Auth ou VPN WireGuard).
- **H3 :** Le stock est géré au niveau central de l'entreprise/dépôt, et chaque sortie de matériau est obligatoirement imputée à un chantier précis pour assurer la traçabilité analytique de la consommation.
- **H4 :** Lors d'un mouvement de sortie de stock sur chantier, seul le volume (quantité et unité) est exigé : le coût unitaire du matériau n'est pas requis à la saisie terrain pour éviter tout blocage du chef de chantier.
- **H5 :** Chaque règlement enregistré sur une facture génère automatiquement une entrée dans le journal de caisse afin de maintenir la cohérence de la trésorerie sans imposer une double saisie à l'utilisateur.
- **H6 :** La clôture d'un chantier (statut `termine`) ne supprime aucune donnée (matériaux consommés, mouvements de caisse, factures) afin de conserver un historique inaltérable des chantiers passés.
- **H7 :** La sauvegarde complète des données consiste simplement en la copie du fichier SQLite désigné par `DB_PATH`, facilitant la sauvegarde manuelle ou par tâche cron sans outil lourd.

---

## Scénarios holdout (recette indépendante du développement)

### Holdout 1 — Cycle complet d'un chantier : Approvisionnement, Consommation, Dépense, Facture et Règlement
1. **Création du chantier :** Créer le client « Société Immobilière Kaba » et créer le chantier « Résidence Palmeraie » rattaché à ce client.
2. **Approvisionnement stock :** Enregistrer l'entrée en stock de 200 sacs de ciment et 100 barres de fer 12mm.
3. **Consommation chantier :** Enregistrer une sortie de stock de 80 sacs de ciment et 40 barres de fer 12mm pour le chantier « Résidence Palmeraie ».
4. **Opérations de caisse :**
   - Enregistrer une Entrée de caisse de 3 000 000 FCFA (Motif : « Apport initial caisse », Mode : Espèces).
   - Enregistrer une Sortie de caisse de 450 000 FCFA (Motif : « Paiement journalier tâcherons maçonnerie », Chantier : « Résidence Palmeraie », Mode : Mobile Money).
5. **Facturation :** Émettre une facture au client « Société Immobilière Kaba » pour le chantier « Résidence Palmeraie » d'un montant total de 2 500 000 FCFA (libellé : « Fondations et élévation gros œuvre »).
6. **Règlement partiel :** Enregistrer un premier acompte client de 1 000 000 FCFA sur cette facture (Mode : Virement/Chèque).
7. **Vérifications observables :**
   - Le stock disponible affiche exactement 120 sacs de ciment et 60 barres de fer 12mm.
   - La fiche du chantier « Résidence Palmeraie » affiche le détail des 80 sacs et 40 barres consommés.
   - Le solde net de caisse est de : `3 000 000 − 450 000 + 1 000 000 = 3 550 000 FCFA`.
   - La facture affiche un montant total de 2 500 000 FCFA, un total réglé de 1 000 000 FCFA, un reste à payer de 1 500 000 FCFA et le statut `partielle`.
   - Le journal de caisse contient bien la ligne automatique d'entrée de 1 000 000 FCFA correspondant au règlement de la facture.

### Holdout 2 — Rendu mobile-first, cibles tactiles et persistance après redémarrage
1. **Contrôle d'affichage mobile :** Configurer le navigateur sur viewport mobile 375×667 px (iPhone SE).
2. **Vérification responsive :** Parcourir les 4 onglets (Chantiers, Stock, Caisse, Factures) et vérifier qu'aucun défilement horizontal n'apparaît (`document.documentElement.scrollWidth === document.documentElement.clientWidth`).
3. **Mesure des cibles tactiles :** Mesurer par script ou inspection CSS que les boutons d'action rapide (« + Entrée », « + Sortie », « + Nouveau chantier », onglets de navigation) possèdent une taille minimale de 44×44 px.
4. **Redémarrage serveur :** Arrêter le serveur Node.js (`kill`), puis le relancer avec la même valeur de `DB_PATH`.
5. **Vérification de persistance :** Recharger la page dans le navigateur ; vérifier que l'ensemble des données créées (clients, chantiers, stocks, transactions de caisse, factures) sont fidèlement restituées sans altération ni perte.

### Holdout 3 — Robustesse face aux cas limites et erreurs de saisie
1. **Refus de sortie de stock excédentaire :** Tenter d'enregistrer une sortie de 500 sacs de ciment alors que le stock disponible est de 120 sacs. L'application doit refuser l'opération avec un message clair (« Stock insuffisant ») sans altérer le stock existant.
2. **Validation des montants de caisse :** Tenter de saisir une transaction de caisse avec un montant négatif (`-50000`) ou nul (`0`). L'opération doit être bloquée avec une erreur HTTP 400 claire.
3. **Plafonnement des règlements de factures :** Tenter d'enregistrer un règlement de 2 000 000 FCFA sur une facture dont le reste à payer est de 1 500 000 FCFA. L'opération doit être refusée afin d'éviter tout surpaiement incohérent.
4. **Résilience du serveur sur identifiant inexistant :** Envoyer une requête `GET /api/chantiers/99999` et `GET /api/factures/99999`. Le serveur renvoie HTTP 404 sans planter ; une requête immédiate vers `GET /health` confirme que le service reste parfaitement opérationnel (HTTP 200).
