/**
 * Petits utilitaires de validation partagés par les routes API.
 *
 * Une seule règle : une saisie invalide ne doit jamais faire planter le serveur
 * (exigence 12 de docs/SPEC.md). Ces fonctions renvoient donc soit une valeur
 * propre, soit `null`, que la route traduit en HTTP 400 ou 404.
 *
 * Les histoires suivantes peuvent les réutiliser telles quelles.
 */

/** Chaîne « utile » : trimée, ou `null` si absente ou vide. */
export function texteOuNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** Entier > 0 accepté depuis un JSON (nombre ou chaîne numérique), sinon `null`. */
export function entierPositifOuNull(value) {
  const brut = typeof value === 'number' ? String(value) : texteOuNull(value);
  if (brut === null || !/^\d+$/.test(brut)) return null;
  const nombre = Number(brut);
  return Number.isSafeInteger(nombre) && nombre > 0 ? nombre : null;
}

/** Identifiant entier > 0 lu dans un paramètre d'URL, sinon `null`. */
export function idEntier(value) {
  return entierPositifOuNull(value);
}

/**
 * Corps de requête utilisable : objet JSON simple, sinon `{}`.
 * (`req.body` vaut `undefined` sans `Content-Type: application/json`.)
 */
export function corpsObjet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}
