/**
 * Configuration de l'instance, lue dans les variables d'environnement.
 *
 * Trois variables pilotent l'application (exigence 11 de docs/SPEC.md) :
 *
 *   PORT             port HTTP      — défaut 8080, cf. src/server.js
 *   DB_PATH          fichier SQLite — défaut ./data/chantier.sqlite, cf. src/db.js
 *   CURRENCY_SYMBOL  symbole affiché — défaut GNF (décision d'Ams du 2026-09-25)
 *
 * Aucun chemin absolu n'est codé en dur : les valeurs par défaut sont relatives au
 * répertoire depuis lequel l'application est lancée, ce qui permet de la déployer
 * sur n'importe quelle machine (poste du gérant, VPS, conteneur).
 */

/** Symbole monétaire par défaut : franc guinéen (docs/DECISIONS.md, 2026-09-25). */
export const DEVISE_PAR_DEFAUT = 'GNF';

/** Port HTTP par défaut. */
export const PORT_PAR_DEFAUT = 8080;

/**
 * Symbole monétaire de l'instance : `CURRENCY_SYMBOL` si défini et non vide,
 * `GNF` sinon. Une valeur vide (`CURRENCY_SYMBOL= npm start`) retombe donc sur
 * le défaut au lieu d'afficher des montants sans devise.
 */
export function resolveCurrencySymbol(symbole) {
  const valeur = symbole === undefined ? process.env.CURRENCY_SYMBOL : symbole;
  const texte = valeur === undefined || valeur === null ? '' : String(valeur).trim();
  return texte === '' ? DEVISE_PAR_DEFAUT : texte;
}

/** Échappe le strict nécessaire avant insertion d'une valeur dans du HTML. */
export function echapperHtml(valeur) {
  return String(valeur ?? '').replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[caractere]));
}

/**
 * Configuration publique de l'instance, servie par `GET /api/config`.
 *
 * L'interface mobile s'en sert au démarrage pour afficher les montants avec le
 * bon symbole sans reconstruire la page : `CURRENCY_SYMBOL=€ npm start` suffit
 * pour basculer toute l'application en euros.
 */
export function configurationPublique() {
  return {
    produit: 'chantier-btp',
    currency_symbol: resolveCurrencySymbol(),
  };
}
