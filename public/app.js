/* Interface terrain de Chantier BTP — JavaScript natif, sans bundler ni framework.
 * Toutes les données viennent de l'API Express existante : aucune règle métier n'est
 * dupliquée ici. Chaque action appelle la route correspondante puis recharge les
 * indicateurs à l'écran, sans rechargement de page. */
/* Symbole monétaire de l'instance : servi par `GET /api/config` (variable
 * d'environnement CURRENCY_SYMBOL, défaut GNF). Il est fixé au démarrage par
 * `definirDevise()` ; tant que la configuration n'est pas chargée, on affiche le
 * défaut pour ne jamais montrer un montant sans devise. */
export const DEVISE_PAR_DEFAUT = 'GNF';
let devise = DEVISE_PAR_DEFAUT;
const UNITES = ['sac', 'barre', 'm3', 'tonne', 'litre', 'piece', 'kg', 'metre', 'lot'];
const MODES_PAIEMENT = [['especes', 'Espèces'], ['mobile_money', 'Mobile Money'], ['virement', 'Virement'], ['cheque', 'Chèque']];
const CATEGORIES = [['achat_materiaux', 'Achat matériaux'], ['main_d_oeuvre', "Main d'œuvre / tâcherons"], ['carburant', 'Carburant'], ['transport', 'Transport'], ['apport_caisse', 'Apport caisse'], ['reglement_client', 'Règlement client'], ['divers', 'Divers']];
const STATUTS_CHANTIER = { en_cours: 'En cours', termine: 'Terminé' };
const STATUTS_FACTURE = { en_attente: 'En attente', partielle: 'Partielle', soldee: 'Soldée' };
const TITRES_VUE = { chantiers: 'Chantiers', stock: 'Stock matériaux', caisse: 'Caisse', factures: 'Factures' };
const $ = (selecteur) => document.querySelector(selecteur);
const $$ = (selecteur) => Array.from(document.querySelectorAll(selecteur));
/** Échappe une valeur avant de l'insérer dans du HTML (noms saisis par l'utilisateur). */
export function echapper(valeur) {
  return String(valeur ?? '').replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[caractere]));
}
/** Montant entier lisible, avec le symbole monétaire de l'instance. */
export function montant(valeur) {
  return `${Number(valeur ?? 0).toLocaleString('fr-FR')} ${devise}`;
}
/** Symbole monétaire actuellement affiché (par défaut `GNF`). */
export function deviseCourante() {
  return devise;
}
/**
 * Fixe le symbole monétaire affiché pour toute la page.
 *
 * Appelé au démarrage avec `GET /api/config`, il met aussi à jour le bandeau
 * supérieur : la valeur visible par l'utilisateur suit donc `CURRENCY_SYMBOL`
 * sans rechargement. Renvoie le symbole retenu (le défaut si la valeur est vide).
 */
export function definirDevise(symbole) {
  const texte = symbole === undefined || symbole === null ? '' : String(symbole).trim();
  if (texte !== '') devise = texte;
  if (typeof document !== 'undefined') {
    const bloc = document.getElementById('devise-app');
    if (bloc) bloc.textContent = devise;
  }
  return devise;
}
/** Date du jour au format AAAA-MM-JJ (valeur par défaut des champs de date). */
function aujourdhui() {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}
/** Affiche l'état de la dernière opération dans le bandeau supérieur. */
function message(texte, type = 'info') {
  const bandeau = $('#etat-reseau');
  bandeau.textContent = texte;
  bandeau.dataset.etat = type;
}
/** Appel API JSON : renvoie la réponse, ou lève l'erreur renvoyée par le serveur. */
async function api(chemin, corps, methode = 'POST') {
  const options = corps === undefined ? undefined
    : { method: methode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) };
  const reponse = await fetch(chemin, options);
  const donnees = reponse.status === 204 ? null : await reponse.json().catch(() => null);
  if (!reponse.ok) throw new Error((donnees && donnees.error) || `Erreur ${reponse.status}`);
  return donnees;
}
/** Lit les champs d'un formulaire : chaînes non vides uniquement. */
function valeurs(formulaire) {
  const objet = {};
  for (const [nom, valeur] of new FormData(formulaire)) {
    const texte = String(valeur).trim();
    if (texte !== '') objet[nom] = texte;
  }
  return objet;
}
/** Exécute une action de formulaire en verrouillant le bouton le temps de l'appel. */
async function soumettre(formulaire, action) {
  const bouton = formulaire.querySelector('button[type="submit"]');
  bouton.disabled = true;
  try {
    await action();
  } catch (erreur) {
    message(erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
}
const etat = { vue: 'chantiers', clients: [], chantiers: [], articles: [], factures: [], factureOuverte: null, factureDetail: null };
let auditLigneAvant = null;
/* --- Navigation entre les onglets ---------------------------------------- */
function afficherVue(nom) {
  etat.vue = nom;
  for (const bouton of $$('.onglet')) {
    const actif = bouton.dataset.vue === nom;
    bouton.setAttribute('aria-selected', String(actif));
  }
  for (const section of $$('.vue')) {
    section.hidden = section.id !== `vue-${nom}`;
  }
  $('#titre-vue').textContent = TITRES_VUE[nom] || 'Chantier BTP';
  window.scrollTo({ top: 0 });
}
/* --- Chargement et rendu des 4 vues ------------------------------------- */
async function chargerClients() {
  etat.clients = await api('/api/clients');
}
async function chargerChantiers() {
  etat.chantiers = await api('/api/chantiers');
  const liste = $('#liste-chantiers');
  $('#chantiers-vide').hidden = etat.chantiers.length > 0;
  liste.innerHTML = etat.chantiers.map((chantier) => `
    <li class="carte"><div class="carte__ligne">
        <h3 class="carte__titre">${echapper(chantier.nom)}</h3> <span class="badge badge--${echapper(chantier.statut)}">${echapper(STATUTS_CHANTIER[chantier.statut] || chantier.statut)}</span>
      </div>
      <p class="carte__meta">${echapper(chantier.client_nom || 'Client inconnu')}${chantier.lieu ? ` · ${echapper(chantier.lieu)}` : ''}${chantier.date_debut ? ` · début ${echapper(chantier.date_debut)}` : ''}</p>
      <div class="actions">
        <button class="bouton bouton--mini" type="button" data-detail-chantier="${chantier.id}">Consommations &amp; dépenses</button>
        ${chantier.statut === 'en_cours' ? `<button class="bouton bouton--mini" type="button" data-clore-chantier="${chantier.id}">Clôturer</button>` : ''}
      </div>
      <div class="panneau" data-panneau="${chantier.id}" hidden></div></li>`).join('');
}
async function chargerStock() {
  const [articles, mouvements] = await Promise.all([api('/api/articles'), api('/api/stock/mouvements')]);
  etat.articles = articles;
  const liste = $('#liste-stock');
  $('#stock-vide').hidden = etat.articles.length > 0;
  liste.innerHTML = etat.articles.map((article) => {
    const stock = Number(article.stock_actuel || 0);
    const seuil = Number(article.seuil_alerte || 0);
    const niveau = stock <= 0 ? 'rupture' : stock <= seuil ? 'alerte' : 'ok';
    const libelle = niveau === 'rupture' ? 'Rupture de stock' : niveau === 'alerte' ? 'Sous le seuil' : 'Disponible';
    const hauteur = Math.max(6, Math.min(100, seuil > 0 ? (stock / (seuil * 2)) * 100 : 100));
    return `
      <li class="carte"><div class="carte__ligne">
          <h3 class="carte__titre">${echapper(article.nom)}</h3> <span class="badge badge--${niveau}">${echapper(libelle)}</span>
        </div>
        <p class="carte__meta"><span class="puce puce--${niveau}"></span><span class="montant">${stock}</span> ${echapper(article.unite)} en stock · seuil ${seuil}</p>
        <div class="niveau niveau--${niveau}" role="img" aria-label="Niveau de stock : ${stock} ${echapper(article.unite)}">
          <span class="niveau__barre" style="width:${hauteur}%"></span></div>
        <div class="actions">
          <button class="bouton bouton--mini bouton--principal" type="button" data-mouvement="entree" data-article="${article.id}">+ Approvisionner</button>
          <button class="bouton bouton--mini bouton--sortie" type="button" data-mouvement="sortie" data-article="${article.id}">+ Sortie chantier</button>
        </div>
        ${mouvements.filter((mouvement) => mouvement.article_id === article.id && !mouvement.annule_par_id && !mouvements.some((compensation) => compensation.annule_par_id === mouvement.id)).map((mouvement) => `<button class="bouton bouton--mini" type="button" data-annuler-stock="${mouvement.id}">Annuler le mouvement du ${echapper(mouvement.date_mouvement)}</button>`).join('')}
      </li>`;
  }).join('');
}
async function chargerCaisse() {
  const [solde, transactions] = await Promise.all([
    api('/api/caisse/solde'),
    api('/api/caisse/transactions'),
  ]);
  $('#caisse-solde').textContent = montant(solde.solde);
  $('#caisse-vide').hidden = transactions.length > 0;
  $('#liste-caisse').innerHTML = transactions.slice(0, 30).map((operation) => `
    <li class="carte"><div class="carte__ligne">
        <h3 class="carte__titre">${echapper(operation.motif)}</h3> <span class="montant montant--${echapper(operation.type)}">${operation.type === 'entree' ? '+' : '−'} ${montant(operation.montant)}</span>
      </div>
      <p class="carte__meta">${echapper(operation.date_transaction)} · ${echapper(operation.categorie)} · ${echapper(operation.mode_paiement)}</p>
      ${!operation.annule_par_id && !String(operation.motif).startsWith('Annulation:') ? `<button class="bouton bouton--mini" type="button" data-annuler-caisse="${operation.id}">Annuler</button>` : ''}
    </li>`).join('');
}
async function chargerFactures() {
  etat.factures = await api('/api/factures');
  $('#factures-vide').hidden = etat.factures.length > 0;
  $('#liste-factures').innerHTML = etat.factures.map((facture) => `
    <li class="carte"><div class="carte__ligne">
        <h3 class="carte__titre">${echapper(facture.numero)}</h3> <span class="badge badge--${echapper(facture.statut)}">${echapper(STATUTS_FACTURE[facture.statut] || facture.statut)}</span>
      </div>
      <p class="carte__meta">${echapper(facture.client_nom)} · ${echapper(facture.chantier_nom)} · ${echapper(facture.date_emission)}</p>
      <p class="carte__meta">Total <span class="montant">${montant(facture.montant_total)}</span> · reste à payer <span class="montant">${montant(facture.reste_a_payer)}</span></p>
      <div class="actions">
        <button class="bouton bouton--mini" type="button" data-ouvrir-facture="${facture.id}">Voir / imprimer</button>
        ${facture.reste_a_payer > 0 ? `<button class="bouton bouton--mini bouton--principal" type="button" data-regler="${facture.id}">Encaisser un règlement</button>` : ''}
      </div>
    </li>`).join('');
}
/* --- Détail d'un chantier (panneau déroulant) ---------------------------- */
async function basculerDetailChantier(id) {
  const panneau = $(`[data-panneau="${id}"]`);
  if (!panneau) return;
  if (!panneau.hidden) {
    panneau.hidden = true;
    return;
  }
  panneau.hidden = false;
  panneau.innerHTML = '<p class="note">Chargement…</p>';
  try {
    const [consommations, depenses] = await Promise.all([
      api(`/api/chantiers/${id}/consommations`),
      api(`/api/caisse/transactions?chantier_id=${id}`),
    ]);
    const total = depenses.reduce((somme, operation) => (
      somme + (operation.type === 'sortie' ? operation.montant : -operation.montant)
    ), 0);
    panneau.innerHTML = `
      <h4>Matériaux consommés</h4>
      ${consommations.length === 0 ? '<p class="note">Aucune sortie de stock pour ce chantier.</p>' : `
        <ul class="liste">
          ${consommations.map((mouvement) => `
            <li class="carte__meta">${echapper(mouvement.date_mouvement)} · <span class="montant">${mouvement.quantite}</span> ${echapper(mouvement.unite)} de ${echapper(mouvement.article_nom)}${mouvement.motif ? ` — ${echapper(mouvement.motif)}` : ''}</li>`).join('')}
        </ul>`}
      <h4>Dépenses rattachées</h4>
      ${depenses.length === 0 ? '<p class="note">Aucun mouvement de caisse sur ce chantier.</p>' : `
        <ul class="liste">
          ${depenses.map((operation) => `
            <li class="carte__meta">${echapper(operation.date_transaction)} · ${echapper(operation.motif)} · <span class="montant montant--${echapper(operation.type)}">${operation.type === 'entree' ? '+' : '−'} ${montant(operation.montant)}</span></li>`).join('')}
        </ul>`}
      <p class="carte__meta">Solde des dépenses nettes : <span class="montant">${montant(total)}</span></p>`;
  } catch (erreur) {
    panneau.innerHTML = `<p class="note">${echapper(erreur.message)}</p>`;
  }
}
/* --- Détail et impression d'une facture ---------------------------------- */
async function ouvrirFacture(id) {
  const facture = await api(`/api/factures/${id}`);
  etat.factureOuverte = facture.id;
  etat.factureDetail = facture;
  afficherVue('factures');
  $('#facture-detail').hidden = false;
  $('#titre-facture-detail').textContent = `Facture ${facture.numero}`;
  $('#facture-contenu').innerHTML = `
    <div class="facture__entete"><p class="facture__emetteur">Chantier BTP</p>
      <p class="note">Entreprise de bâtiment et travaux publics</p>
      <p class="facture__numero">${echapper(facture.numero)}</p>
      <p class="note">${echapper(facture.client_nom)}</p></div>
    <div class="facture__bloc"><p><strong>Client :</strong> ${echapper(facture.client_nom)}</p>
      <p><strong>Chantier :</strong> ${echapper(facture.chantier_nom)}</p>
      <p><strong>Émise le :</strong> ${echapper(facture.date_emission)}${facture.date_echeance ? ` — échéance ${echapper(facture.date_echeance)}` : ''}</p>
      <p><strong>Statut :</strong> <span class="badge badge--${echapper(facture.statut)}">${echapper(STATUTS_FACTURE[facture.statut] || facture.statut)}</span></p>
    </div>
    <table class="facture__table"><thead>
        <tr><th>Désignation</th><th>Qté</th><th class="col-pu">P.U.</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${facture.lignes.map((ligne) => `
          <tr><td>${echapper(ligne.designation)}</td>
            <td>${ligne.quantite}</td><td class="col-pu">${montant(ligne.prix_unitaire)}</td>
            <td>${montant(ligne.total_ligne)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="facture__bloc">
      <p class="facture__total"><span>Total facture</span><span class="montant">${montant(facture.montant_total)}</span></p>
      <p class="facture__total"><span>Règlements perçus</span><span class="montant">${montant(facture.montant_regle)}</span></p>
      <p class="facture__total facture__total--net"><span>Net à payer</span><span class="montant">${montant(facture.reste_a_payer)}</span></p>
    </div>
    <div class="facture__bloc"><h3>Règlements perçus</h3>
      ${facture.reglements.length === 0 ? '<p class="note">Aucun règlement enregistré.</p>' : `
        <ul class="liste">
          ${facture.reglements.map((reglement) => `
            <li class="carte__meta">${echapper(reglement.date_reglement)} · ${echapper(reglement.mode_paiement)} · <span class="montant">${montant(reglement.montant)}</span>${reglement.reference ? ` — ${echapper(reglement.reference)}` : ''}</li>`).join('')}
        </ul>`}
    </div>
    ${facture.montant_regle === 0 ? `
    <div class="facture__bloc no-impression"><h3>Corriger une ligne</h3>
      <ul class="liste">
        ${facture.lignes.map((ligne) => `
          <li class="carte__meta">${echapper(ligne.designation)} — ${ligne.quantite} × ${montant(ligne.prix_unitaire)} <button class="bouton bouton--mini" type="button" data-corriger-ligne="${facture.id}:${ligne.id}">Corriger</button></li>`).join('')}
      </ul>
    </div>` : ''}
    <p class="note">Facture acquittée dès règlement intégral du net à payer.</p>`;
}
/** Imprime la facture seule (la navigation et les boutons sont masqués par @media print). */
function imprimerFacture() {
  if (!etat.factureOuverte) {
    message('Ouvrez une facture avant d’imprimer', 'erreur');
    return;
  }
  document.body.dataset.impression = 'facture';
  window.addEventListener('afterprint', () => { delete document.body.dataset.impression; }, { once: true });
  window.print();
}
/* --- Dialogues et formulaires -------------------------------------------- */
function ouvrirDialogue(id) {
  const dialogue = document.getElementById(id);
  if (dialogue && typeof dialogue.showModal === 'function') dialogue.showModal();
}
/** Remplit un <select> avec des options [valeur, libellé]. */
function remplirSelect(selecteur, options, { vide = null, valeurForcee = null } = {}) {
  const select = typeof selecteur === 'string' ? $(selecteur) : selecteur;
  const morceaux = vide === null ? [] : [`<option value="">${echapper(vide)}</option>`];
  for (const [valeur, libelle] of options) morceaux.push(`<option value="${echapper(valeur)}">${echapper(libelle)}</option>`);
  select.innerHTML = morceaux.join('');
  if (valeurForcee !== null) select.value = String(valeurForcee);
}
function optionsChantiers() {
  return etat.chantiers.map((chantier) => [chantier.id, `${chantier.nom} — ${chantier.client_nom || ''}`.trim()]);
}
function optionsArticles() {
  return etat.articles.map((article) => [article.id, `${article.nom} (${article.stock_actuel} ${article.unite})`]);
}
function optionsFacturesARegler() {
  return etat.factures
    .filter((facture) => facture.reste_a_payer > 0)
    .map((facture) => [facture.id, `${facture.numero} — reste ${montant(facture.reste_a_payer)}`]);
}
async function recharger(domaines) {
  await Promise.all(domaines.map((nom) => ({
    clients: chargerClients,
    chantiers: chargerChantiers,
    stock: chargerStock,
    caisse: chargerCaisse,
    factures: chargerFactures,
  }[nom]())));
}
/* --- Initialisation ------------------------------------------------------ */
function brancherEvenements() {
  $('#onglets').addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('.onglet');
    if (bouton) afficherVue(bouton.dataset.vue);
  });
  document.addEventListener('click', (evenement) => {
    const cible = evenement.target.closest('[data-ouvrir], [data-fermer], [data-detail-chantier], [data-ouvrir-facture], [data-regler], [data-mouvement], [data-annuler-stock], [data-annuler-caisse], [data-corriger-ligne]');
    if (!cible) return;
    if (cible.dataset.fermer !== undefined) {
      cible.closest('dialog').close();
      return;
    }
    if (cible.dataset.detailChantier) {
      basculerDetailChantier(Number(cible.dataset.detailChantier));
      return;
    }
    if (cible.dataset.ouvrirFacture) {
      ouvrirFacture(Number(cible.dataset.ouvrirFacture)).catch((erreur) => message(erreur.message, 'erreur'));
      return;
    }
    if (cible.dataset.regler) {
      preparerReglement(Number(cible.dataset.regler));
      ouvrirDialogue('dialogue-reglement');
      return;
    }
    if (cible.dataset.mouvement) {
      preparerMouvement(cible.dataset.mouvement, Number(cible.dataset.article));
      return;
    }
    if (cible.dataset.annulerStock) { preparerAudit('stock', cible.dataset.annulerStock, 'Annuler le mouvement'); ouvrirDialogue('dialogue-audit'); return; }
    if (cible.dataset.annulerCaisse) { preparerAudit('caisse', cible.dataset.annulerCaisse, 'Annuler la transaction'); ouvrirDialogue('dialogue-audit'); return; }
    if (cible.dataset.corrigerLigne) {
      const [factureId, ligneId] = cible.dataset.corrigerLigne.split(':').map(Number);
      const facture = etat.factureDetail && etat.factureDetail.id === factureId ? etat.factureDetail : null;
      const ligne = facture && facture.lignes ? facture.lignes.find((item) => item.id === ligneId) : null;
      if (!ligne) { message('Ligne de facture introuvable', 'erreur'); return; }
      preparerAudit('facture', factureId, `Corriger « ${ligne.designation} »`, ligne);
      ouvrirDialogue('dialogue-audit');
      return;
    }
    if (cible.dataset.ouvrir) {
      const dialogue = cible.dataset.ouvrir;
      if (dialogue === 'dialogue-chantier') preparerChantier();
      if (dialogue === 'dialogue-mouvement') preparerMouvement(cible.dataset.type || 'entree', null);
      if (dialogue === 'dialogue-transaction') preparerTransaction(cible.dataset.type || 'entree');
      if (dialogue === 'dialogue-facture') preparerFacture();
      if (dialogue === 'dialogue-reglement') preparerReglement(null);
      ouvrirDialogue(dialogue);
    }
  });
}
function preparerChantier() {
  const formulaire = $('#form-chantier');
  formulaire.reset();
  remplirSelect('#chantier-client', etat.clients.map((client) => [client.id, client.nom]), { vide: '— choisir un client —' });
  formulaire.elements.date_debut.value = aujourdhui();
}
async function preparerMouvement(type, articleId) {
  const formulaire = $('#form-mouvement');
  formulaire.reset();
  formulaire.elements.type.value = type;
  formulaire.elements.date_mouvement.value = aujourdhui();
  $('#titre-mouvement').textContent = type === 'sortie' ? 'Sortie chantier' : 'Approvisionner';
  $('#champ-mouvement-chantier').hidden = type !== 'sortie';
  formulaire.elements.chantier_id.required = type === 'sortie';
  remplirSelect('#mouvement-article', optionsArticles(), { vide: '— choisir un article —', valeurForcee: articleId });
  remplirSelect('#mouvement-chantier', optionsChantiers(), { vide: '— choisir un chantier —' });
}
function preparerAudit(domaine, referenceId, titre, ligne) {
  $('#audit-domaine').value = domaine;
  $('#audit-reference').value = referenceId;
  $('#audit-motif').value = '';
  $('#titre-audit').textContent = titre;
  const estFacture = domaine === 'facture';
  $('#champ-audit-ligne').hidden = !estFacture;
  $('#audit-ligne-id').value = ligne ? ligne.id : '';
  $('#audit-designation').value = ligne ? ligne.designation : '';
  $('#audit-designation').required = estFacture;
  $('#audit-quantite').value = ligne ? ligne.quantite : '';
  $('#audit-quantite').required = estFacture;
  $('#audit-prix-unitaire').value = ligne ? ligne.prix_unitaire : '';
  $('#audit-prix-unitaire').required = estFacture;
  auditLigneAvant = ligne || null;
}
function preparerTransaction(type) {
  const formulaire = $('#form-transaction');
  formulaire.reset();
  formulaire.elements.type.value = type;
  formulaire.elements.date_transaction.value = aujourdhui();
  $('#titre-transaction').textContent = type === 'entree' ? 'Nouvelle entrée de caisse' : 'Nouvelle sortie de caisse';
  remplirSelect('#transaction-mode', MODES_PAIEMENT, { valeurForcee: 'especes' });
  remplirSelect('#transaction-categorie', CATEGORIES, { valeurForcee: type === 'entree' ? 'apport_caisse' : 'achat_materiaux' });
  remplirSelect('#transaction-chantier', optionsChantiers(), { vide: '— aucun chantier —' });
}
function majResteReglement() {
  const factureId = Number($('#reglement-facture').value);
  const facture = etat.factures.find((item) => item.id === factureId);
  $('#reglement-reste').textContent = facture
    ? `Reste à payer : ${montant(facture.reste_a_payer)}`
    : 'Aucune facture en attente de règlement.';
}
function preparerReglement(factureId) {
  const formulaire = $('#form-reglement');
  formulaire.reset();
  formulaire.elements.date_reglement.value = aujourdhui();
  remplirSelect('#reglement-facture', optionsFacturesARegler(), { vide: '— choisir une facture —', valeurForcee: factureId });
  remplirSelect('#reglement-mode', MODES_PAIEMENT, { valeurForcee: 'especes' });
  majResteReglement();
}
function ajouterLigneFacture() {
  const modele = $('#gabarit-ligne-facture').content.cloneNode(true);
  $('#lignes-facture').append(modele);
}
function preparerFacture() {
  const formulaire = $('#form-facture');
  formulaire.reset();
  formulaire.elements.date_emission.value = aujourdhui();
  $('#lignes-facture').innerHTML = '';
  ajouterLigneFacture();
  remplirSelect('#facture-chantier', optionsChantiers(), { vide: '— choisir un chantier —' });
}
export function initialiserInterface() {
  brancherEvenements();
  const remplissages = [
    ['#article-unite', UNITES.map((unite) => [unite, unite])],
  ];
  for (const [selecteur, options] of remplissages) remplirSelect(selecteur, options);
  $('#bouton-imprimer').addEventListener('click', imprimerFacture);
  $('#bouton-fermer-facture').addEventListener('click', () => {
    $('#facture-detail').hidden = true;
    etat.factureOuverte = null;
  });
  $('#bouton-ajouter-ligne').addEventListener('click', ajouterLigneFacture);
  $('#reglement-facture').addEventListener('change', majResteReglement);
  $('#form-chantier').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    // currentTarget vaut null après le premier `await` : on capture le formulaire.
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      let clientId = valeursSaisies.client_id;
      if (!clientId) {
        if (!valeursSaisies.client_nom) throw new Error('Choisissez un client ou saisissez le nom du nouveau client');
        const client = await api('/api/clients', { nom: valeursSaisies.client_nom });
        clientId = client.id;
      }
      await api('/api/chantiers', { client_id: Number(clientId), nom: valeursSaisies.nom, lieu: valeursSaisies.lieu, date_debut: valeursSaisies.date_debut, statut: valeursSaisies.statut, });
      formulaire.closest('dialog').close();
      message('Chantier enregistré', 'ok');
      await recharger(['chantiers', 'clients']);
      afficherVue('chantiers');
    });
  });
  $('#form-article').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      await api('/api/articles', { nom: valeursSaisies.nom, unite: valeursSaisies.unite, seuil_alerte: Number(valeursSaisies.seuil_alerte || 0), });
      formulaire.closest('dialog').close();
      message('Article ajouté au catalogue', 'ok');
      await recharger(['stock']);
    });
  });
  $('#form-mouvement').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      await api('/api/stock/mouvements', { article_id: Number(valeursSaisies.article_id), type: valeursSaisies.type, quantite: Number(valeursSaisies.quantite), chantier_id: valeursSaisies.chantier_id ? Number(valeursSaisies.chantier_id) : undefined, date_mouvement: valeursSaisies.date_mouvement, motif: valeursSaisies.motif, });
      formulaire.closest('dialog').close();
      message('Mouvement de stock enregistré', 'ok');
      await recharger(['stock']);
    });
  });
  $('#form-transaction').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      await api('/api/caisse/transactions', { type: valeursSaisies.type, montant: Number(valeursSaisies.montant), mode_paiement: valeursSaisies.mode_paiement, categorie: valeursSaisies.categorie, motif: valeursSaisies.motif, chantier_id: valeursSaisies.chantier_id ? Number(valeursSaisies.chantier_id) : undefined, date_transaction: valeursSaisies.date_transaction, });
      formulaire.closest('dialog').close();
      message('Opération de caisse enregistrée', 'ok');
      await recharger(['caisse', 'chantiers']);
      afficherVue('caisse');
    });
  });
  $('#form-facture').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      const lignes = $$('#lignes-facture .ligne-facture').map((bloc) => ({
        designation: bloc.querySelector('[name="designation"]').value.trim(),
        quantite: Number(bloc.querySelector('[name="quantite"]').value),
        prix_unitaire: Number(bloc.querySelector('[name="prix_unitaire"]').value),
      }));
      if (lignes.length === 0) throw new Error('Ajoutez au moins une ligne de prestation');
      const facture = await api('/api/factures', { chantier_id: Number(valeursSaisies.chantier_id), date_emission: valeursSaisies.date_emission, date_echeance: valeursSaisies.date_echeance, lignes, });
      formulaire.closest('dialog').close();
      message(`Facture ${facture.numero} émise`, 'ok');
      await recharger(['factures']);
      await ouvrirFacture(facture.id);
    });
  });
  $('#form-reglement').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const valeursSaisies = valeurs(formulaire);
      const factureId = Number(valeursSaisies.facture_id);
      const facture = await api(`/api/factures/${factureId}/reglements`, { montant: Number(valeursSaisies.montant), mode_paiement: valeursSaisies.mode_paiement, date_reglement: valeursSaisies.date_reglement, reference: valeursSaisies.reference, });
      formulaire.closest('dialog').close();
      message(`Règlement encaissé sur ${facture.numero}`, 'ok');
      await recharger(['factures', 'caisse']);
      await ouvrirFacture(factureId);
    });
  });
  $('#form-audit').addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.currentTarget;
    soumettre(formulaire, async () => {
      const domaine = formulaire.elements.domaine.value;
      const id = formulaire.elements.reference_id.value;
      const motif = formulaire.elements.motif.value.trim();
      if (domaine === 'facture') {
        const ligneId = formulaire.elements.ligne_id.value;
        if (!ligneId || !auditLigneAvant) throw new Error('Ouvrez une facture et choisissez une ligne à corriger');
        const designation = formulaire.elements.designation.value.trim();
        const quantite = Number(formulaire.elements.quantite.value);
        const prixUnitaire = Number(formulaire.elements.prix_unitaire.value);
        const inchangee = designation === auditLigneAvant.designation
          && quantite === auditLigneAvant.quantite
          && prixUnitaire === auditLigneAvant.prix_unitaire;
        if (inchangee) throw new Error('Aucune valeur modifiée — rien à corriger');
        await api(`/api/factures/${etat.factureDetail.id}/lignes/${ligneId}`, {
          designation, quantite, prix_unitaire: prixUnitaire, motif,
        }, 'PATCH');
        await recharger(['factures']);
        await ouvrirFacture(etat.factureDetail.id);
      } else {
        await api(`/api/${domaine === 'stock' ? 'stock/mouvements' : 'caisse/transactions'}/${id}/annuler`, { motif });
        await recharger([domaine]);
      }
      formulaire.closest('dialog').close();
      message('Opération enregistrée avec piste d’audit', 'ok');
    });
  });
  // Clôture d'un chantier (bouton rendu par chargerChantiers) : PATCH /api/chantiers/:id
  document.addEventListener('click', async (evenement) => {
    const bouton = evenement.target.closest('[data-clore-chantier]');
    if (!bouton) return;
    bouton.disabled = true;
    try {
      await api(`/api/chantiers/${bouton.dataset.cloreChantier}`, { statut: 'termine' }, 'PATCH');
      message('Chantier clôturé', 'ok');
      await recharger(['chantiers']);
    } catch (erreur) {
      message(erreur.message, 'erreur');
      bouton.disabled = false;
    }
  });
  return api('/api/config')
    // Devise de l'instance : si la route est indisponible, on garde le défaut (GNF)
    // plutôt que d'empêcher l'affichage des données.
    .then((configuration) => definirDevise(configuration.currency_symbol))
    .catch(() => deviseCourante())
    .then(() => recharger(['clients', 'chantiers', 'stock', 'caisse', 'factures']))
    .then(() => {
      afficherVue('chantiers');
      message('Données à jour', 'ok');
    })
    .catch((erreur) => message(`Chargement impossible : ${erreur.message}`, 'erreur'));
}
// Démarrage automatique dans le navigateur ; le module reste importable côté Node
// (tests) sans DOM.
if (typeof document !== 'undefined' && document.getElementById('onglets')) {
  initialiserInterface();
}