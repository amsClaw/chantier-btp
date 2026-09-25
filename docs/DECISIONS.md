# Décisions produit — Gestion de chantier BTP

Journal des arbitrages d'Ams qui précisent ou corrigent la SPEC du cadreur.
Le cadreur a livré sa spec le 2026-09-24 (carte `t_70bb2a91`) ; les décisions ci-dessous
priment en cas d'écart.

## 2026-09-25 — Devise par défaut : franc guinéen (GNF)

- `CURRENCY_SYMBOL` prend la valeur par défaut **`GNF`** (et non `FCFA` comme proposé dans la spec).
- Reste paramétrable (`FCFA`, `€`, …) sans modification du code.
- Les montants restent des entiers (pas de centimes).
- Les montants cités en exemple dans les histoires (« 500 000 FCFA ») sont illustratifs : seul le
  symbole affiché change, la logique de calcul est identique.

## 2026-09-25 — Authentification : aucune pour la v1 (assumé)

- L'application reste **sans mot de passe** (accès libre sur le réseau local du bureau ou du chantier),
  conformément à l'hypothèse H2 de la spec.
- Si l'application est un jour exposée sur internet, la protection se fera **en amont** (reverse proxy
  avec authentification, ou VPN) et non dans le code du produit.
- Ams n'a pas encore tranché ce point : à confirmer avant la mise en ligne publique.

## 2026-09-25 — Correction et annulation de saisie avec piste d'audit (Histoire 8)

- Constat pendant la recette manuelle d'Ams : aucune saisie (mouvement de stock, opération
  de caisse, ligne de facture) ne peut être corrigée ni supprimée depuis l'interface. Une
  erreur de frappe (ex. un zéro de trop sur un prix unitaire) reste bloquante — la seule
  option observée a été une correction manuelle en base, hors produit.
- Décision : **jamais de suppression physique**. Toute correction ou annulation se fait par
  une **écriture compensatoire** (mouvement inverse, ligne de correction) qui laisse la
  saisie d'origine visible, horodatée, avec un **motif obligatoire**. Cohérent avec le choix
  déjà fait par le cadreur de n'exposer aucune route `DELETE`.
- Portée : `mouvements_stock`, `transactions_caisse`, `lignes_facture` (uniquement tant
  qu'aucun règlement n'a été perçu sur la facture — au-delà, seule une correction
  compensatoire est possible, jamais une modification de la ligne d'origine).
- Cadré en Histoire 8 (`docs/HISTOIRES.md`). **Liste 2 de `POLICY.md`** : cette histoire
  touche la correction de données financières déjà émises (caisse, factures) — la fusion
  en production attend la validation explicite d'Ams après revue, pas d'auto-merge.
