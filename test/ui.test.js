import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { echapper, montant } from '../public/app.js';
import { startServer } from '../src/server.js';
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (chemin) => fs.readFileSync(path.join(RACINE, chemin), 'utf8');
const htmlPage = lire('index.html');
const css = lire('public/styles.css');
const jsClient = lire('public/app.js');
/** Démarre un serveur réel (port 0 + base temporaire) pour tester le service des fichiers. */
async function demarrerServeur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-ui-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'data', 'chantier.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}
/** Déclarations d'une règle CSS donnée (« .bouton » → « min-height: …; … »). */
function blocCss(contenu, selecteur) {
  const normalise = contenu.replace(/\s+/g, ' ');
  const cible = `${selecteur.replace(/\s+/g, ' ')} {`;
  const debut = normalise.indexOf(cible);
  if (debut === -1) return '';
  const fin = normalise.indexOf('}', debut);
  return fin === -1 ? '' : normalise.slice(debut, fin);
}
/* --- Page servie sur GET / ------------------------------------------------ */
test('GET / sert la page unique de l’interface (HTML, sans bundler)', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const res = await fetch(`${instance.url}/`);
  const corps = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(corps, /^<!doctype html>/i);
  assert.match(corps, /<html lang="fr">/);
  assert.match(corps, /name="viewport"/);
  // Aucune trace de bundler ni de framework SPA : uniquement HTML, CSS et JS natifs.
  assert.match(corps, /<link rel="stylesheet" href="public\/styles\.css">/);
  assert.match(corps, /<script type="module" src="public\/app\.js"><\/script>/);
  assert.doesNotMatch(corps, /\b(webpack|vite|react|bootstrap|angular|svelte|jquery)\b/i);
});
test('la page contient les 4 vues et la barre d’onglets persistante', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const corps = await (await fetch(`${instance.url}/`)).text();
  for (const vue of ['chantiers', 'stock', 'caisse', 'factures']) {
    assert.match(corps, new RegExp(`id="vue-${vue}"`), `vue ${vue} absente`);
    assert.match(corps, new RegExp(`data-vue="${vue}"`), `onglet ${vue} absent`);
  }
  assert.match(corps, /<nav class="onglets" id="onglets"/);
  // Bandeau supérieur clair, séparé de la barre d'onglets.
  assert.match(corps, /<header class="bandeau">/);
  // Chaque vue a un bouton d'action nommé comme dans l'histoire.
  for (const libelle of [
    '+ Nouveau chantier',
    '+ Approvisionner',
    '+ Sortie chantier',
    '+ Entrée',
    '− Sortie',
    '+ Nouvelle facture',
    'Encaisser un règlement',
    'Imprimer / PDF',
  ]) {
    assert.ok(corps.includes(libelle), `bouton « ${libelle} » absent`);
  }
  // Caisse : solde net affiché en tête de vue.
  assert.match(corps, /id="caisse-solde"/);
  assert.match(corps, /Solde net disponible/);
  // Factures : une vue détail et son bouton d'impression.
  assert.match(corps, /id="facture-detail"/);
  assert.match(corps, /id="bouton-imprimer"/);
});
test('les ressources statiques de l’interface sont servies, le code serveur ne l’est pas', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const feuille = await fetch(`${instance.url}/public/styles.css`);
  assert.equal(feuille.status, 200);
  assert.match(feuille.headers.get('content-type') ?? '', /text\/css/);
  assert.match(await feuille.text(), /--cible: 44px/);
  const script = await fetch(`${instance.url}/public/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  assert.match(await script.text(), /\/api\/chantiers/);
  assert.equal((await fetch(`${instance.url}/public/inexistant.css`)).status, 404);
  assert.equal((await fetch(`${instance.url}/src/server.js`)).status, 404);
  assert.equal((await fetch(`${instance.url}/.git/config`)).status, 404);
});
/* --- Contraintes ergonomiques mobiles ------------------------------------- */
test('le CSS livre des cibles tactiles de 44 px minimum', () => {
  assert.match(blocCss(css, ':root'), /--cible:\s*44px/);
  const bouton = blocCss(css, '.bouton');
  assert.match(bouton, /min-height:\s*var\(--cible\)/, 'les boutons doivent faire 44 px de haut');
  assert.match(bouton, /min-width:\s*var\(--cible\)/, 'les boutons doivent faire 44 px de large');
  const onglet = blocCss(css, '.onglet');
  assert.match(onglet, /min-height:\s*var\(--cible\)/);
  assert.match(onglet, /min-width:\s*var\(--cible\)/);
  const champs = blocCss(css, 'input, select, textarea');
  assert.match(champs, /min-height:\s*var\(--cible\)/, 'les champs et sélecteurs doivent faire 44 px');
});
test('le CSS empêche tout défilement horizontal sur 375 px', () => {
  assert.match(blocCss(css, 'html'), /overflow-x:\s*clip/);
  assert.match(blocCss(css, 'body'), /overflow-x:\s*clip/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
  // Les grilles et le tableau de facture ne peuvent pas dépasser leur conteneur.
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(240px,\s*100%\),\s*1fr\)\)/);
  assert.match(blocCss(css, '.facture__table'), /table-layout:\s*fixed/);
  // Colonne « prix unitaire » retirée sur petit écran, rétablie à l'impression.
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.col-pu[\s\S]*?display: none/);
});
test('les saisies numériques utilisent <input type="number">', () => {
  const champs = htmlPage.match(/<input type="number"/g) ?? [];
  assert.ok(champs.length >= 5, `attendu au moins 5 champs numériques, trouvé ${champs.length}`);
  for (const nom of ['quantite', 'montant', 'prix_unitaire', 'seuil_alerte']) {
    assert.match(htmlPage, new RegExp(`<input type="number" name="${nom}"`), `champ ${nom} non numérique`);
  }
  assert.match(htmlPage, /inputmode="numeric"/);
});
/* --- Impression ------------------------------------------------------------ */
test('la feuille de style masque navigation, boutons et ombres à l’impression', () => {
  const index = css.indexOf('@media print');
  assert.ok(index > -1, 'aucune règle @media print');
  const impression = css.slice(index);
  assert.match(impression, /size:\s*A4/);
  for (const selecteur of ['.onglets', '.bandeau', '.bouton', '.dialogue']) {
    assert.ok(impression.includes(selecteur), `${selecteur} doit être masqué à l’impression`);
  }
  assert.match(impression, /display:\s*none\s*!important/);
  assert.match(impression, /box-shadow:\s*none\s*!important/);
  assert.match(impression, /body\[data-impression="facture"\]/);
  // Le bouton d'impression déclenche bien window.print().
  assert.match(jsClient, /window\.print\(\)/);
});
/* --- Contrat avec l'API ---------------------------------------------------- */
test('le client appelle les routes API stabilisées, sans recharger la page', () => {
  for (const route of [
    '/api/clients',
    '/api/chantiers',
    '/api/articles',
    '/api/stock/mouvements',
    '/api/caisse/solde',
    '/api/caisse/transactions',
    '/api/factures',
  ]) {
    assert.ok(jsClient.includes(route), `route ${route} non appelée par l’interface`);
  }
  assert.match(jsClient, /\/api\/factures\/\$\{[^}]+\}\/reglements/);
  assert.match(jsClient, /\/api\/chantiers\/\$\{[^}]+\}\/consommations/);
  assert.match(jsClient, /fetch\(/);
  // Aucune règle métier recalculée côté client : pas de calcul de statut de facture.
  assert.doesNotMatch(jsClient, /soldee['"]?\s*:\s*.{0,40}montant_regle\s*===/);
});
test('chaque domaine rechargeable a bien sa fonction de chargement', () => {
  const domaines = [...jsClient.matchAll(/^\s+(\w+): (charger\w+),$/gm)];
  assert.ok(domaines.length >= 5, `attendu au moins 5 domaines rechargeables, trouvé ${domaines.length}`);
  for (const [, cle, fonction] of domaines) {
    assert.ok(
      new RegExp(`async function ${fonction}\\(`).test(jsClient),
      `le domaine « ${cle} » référence ${fonction}(), qui n'existe pas`,
    );
  }
  // Les clients sont nécessaires au formulaire de chantier et sont chargés au démarrage.
  assert.match(jsClient, /recharger\(\['clients', 'chantiers', 'stock', 'caisse', 'factures'\]\)/);
});
test('aucun usage de currentTarget après un await (piège du null)', () => {
  const lignes = jsClient.split('\n').filter((ligne) => ligne.includes('.currentTarget'));
  assert.ok(lignes.length >= 6, `attendu au moins 6 captures de formulaire, trouvé ${lignes.length}`);
  for (const ligne of lignes) {
    assert.match(
      ligne.trim(),
      /^const formulaire = evenement\.currentTarget;$/,
      `currentTarget doit être capturé avant tout await : « ${ligne.trim()} »`,
    );
  }
});
test('chaque élément interrogé par le client existe bien dans la page', () => {
  const identifiants = [...jsClient.matchAll(/\$+\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)]
    .map((trouve) => trouve[1] ?? trouve[2]);
  assert.ok(identifiants.length >= 15, `attendu au moins 15 sélecteurs, trouvé ${identifiants.length}`);
  const manquants = identifiants.filter((identifiant) => !htmlPage.includes(`id="${identifiant}"`));
  assert.deepEqual(manquants, [], `identifiants absents de index.html : ${manquants.join(', ')}`);
  // Les classes posées par le client ont bien un style correspondant.
  for (const classe of [
    'bandeau', 'onglet', 'onglets', 'bouton', 'carte', 'badge', 'niveau', 'niveau__barre',
    'puce', 'solde__valeur', 'panneau', 'champ', 'dialogue', 'formulaire', 'liste',
    'facture__table', 'facture__total', 'ligne-facture', 'montant', 'vide',
  ]) {
    assert.ok(css.includes(`.${classe}`), `classe .${classe} absente de la feuille de style`);
  }
});
test('les valeurs saisies sont échappées avant insertion dans le HTML', () => {
  assert.equal(echapper('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(echapper('Ciment "CIM-II" & sable'), 'Ciment &quot;CIM-II&quot; &amp; sable');
  assert.equal(echapper('Villa Kaba'), 'Villa Kaba');
  // Les noms de clients/chantiers/article passent bien par echapper() au rendu.
  assert.match(jsClient, /echapper\(chantier\.nom\)/);
  assert.match(jsClient, /echapper\(article\.nom\)/);
  assert.match(jsClient, /echapper\(operation\.motif\)/);
});
test('les montants sont formatés en entiers avec le symbole monétaire', () => {
  const attendu = (valeur) => montant(valeur).replace(/\u202f|\u00a0/g, ' ');
  assert.equal(attendu(0), '0 GNF');
  assert.equal(attendu(1500000), '1 500 000 GNF');
  assert.equal(attendu(null), '0 GNF');
});
/* --- Parcours réel : les charges utiles envoyées par l'interface ------------ */
test('parcours interface : chantier, stock, caisse et facture de bout en bout', async (t) => {
  const instance = await demarrerServeur();
  t.after(() => instance.close());
  const url = instance.url;
  const envoyer = async (chemin, corps, methode = 'POST') => {
    const res = await fetch(`${url}${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
    return { statut: res.status, corps: await res.json() };
  };
  // 1. « + Nouveau chantier » avec un nouveau client saisi dans le même formulaire.
  const client = await envoyer('/api/clients', { nom: 'Mme Camara' });
  assert.equal(client.statut, 201);
  const chantier = await envoyer('/api/chantiers', {
    client_id: client.corps.id,
    nom: 'Villa Kaba',
    lieu: 'Ratoma, Conakry',
    date_debut: '2026-09-01',
    statut: 'en_cours',
  });
  assert.equal(chantier.statut, 201);
  assert.match((await (await fetch(`${url}/api/chantiers`)).json())[0].client_nom, /Camara/);
  // 2. « + Approvisionner » puis « + Sortie chantier » (105 - 35 = 70 en stock).
  const article = await envoyer('/api/articles', { nom: 'Ciment', unite: 'sac', seuil_alerte: 20 });
  assert.equal(article.statut, 201);
  const entree = await envoyer('/api/stock/mouvements', {
    article_id: article.corps.id, type: 'entree', quantite: 105, date_mouvement: '2026-09-02', motif: 'Livraison',
  });
  assert.equal(entree.statut, 201);
  const sortie = await envoyer('/api/stock/mouvements', {
    article_id: article.corps.id, type: 'sortie', quantite: 35,
    chantier_id: chantier.corps.id, date_mouvement: '2026-09-03', motif: 'Coulage dalle',
  });
  assert.equal(sortie.statut, 201);
  const stock = await (await fetch(`${url}/api/articles`)).json();
  assert.equal(stock[0].stock_actuel, 70);
  const consommations = await (await fetch(`${url}/api/chantiers/${chantier.corps.id}/consommations`)).json();
  assert.equal(consommations.length, 1);
  assert.equal(consommations[0].article_nom, 'Ciment');
  // 3. « + Entrée » / « − Sortie » en caisse, puis solde net affiché.
  await envoyer('/api/caisse/transactions', {
    type: 'entree', montant: 3000000, mode_paiement: 'mobile_money', categorie: 'apport_caisse',
    motif: 'Apport gérant', date_transaction: '2026-09-02',
  });
  await envoyer('/api/caisse/transactions', {
    type: 'sortie', montant: 150000, mode_paiement: 'especes', categorie: 'achat_materiaux',
    motif: 'Achat gravier', chantier_id: chantier.corps.id, date_transaction: '2026-09-03',
  });
  const solde = await (await fetch(`${url}/api/caisse/solde`)).json();
  assert.equal(solde.solde, 2850000);
  const depenses = await (await fetch(`${url}/api/caisse/transactions?chantier_id=${chantier.corps.id}`)).json();
  assert.equal(depenses.length, 1);
  // 4. « + Nouvelle facture » avec deux lignes, puis « Encaisser un règlement ».
  const facture = await envoyer('/api/factures', {
    chantier_id: chantier.corps.id,
    date_emission: '2026-09-10',
    date_echeance: '2026-10-10',
    lignes: [
      { designation: 'Maçonnerie', quantite: 1, prix_unitaire: 1500000 },
      { designation: 'Fer à béton', quantite: 20, prix_unitaire: 25000 },
    ],
  });
  assert.equal(facture.statut, 201);
  assert.equal(facture.corps.montant_total, 2000000);
  assert.equal(facture.corps.reste_a_payer, 2000000);
  assert.equal(facture.corps.statut, 'en_attente');
  const acompte = await envoyer(
    `/api/factures/${facture.corps.id}/reglements`,
    { montant: 800000, mode_paiement: 'especes', date_reglement: '2026-09-12', reference: 'reçu n° 12' },
  );
  assert.equal(acompte.statut, 201);
  assert.equal(acompte.corps.statut, 'partielle');
  assert.equal(acompte.corps.reste_a_payer, 1200000);
  const soude = await envoyer(
    `/api/factures/${facture.corps.id}/reglements`,
    { montant: 1200000, mode_paiement: 'virement', date_reglement: '2026-09-20' },
  );
  assert.equal(soude.corps.statut, 'soldee');
  assert.equal(soude.corps.reste_a_payer, 0);
  // Le règlement alimente la caisse sans double saisie (exigence 8 de la spec).
  const soldeFinal = await (await fetch(`${url}/api/caisse/solde`)).json();
  assert.equal(soldeFinal.solde, 4850000);
  // 5. Clôture du chantier depuis la liste (PATCH), puis la vue détail de facture.
  const cloture = await envoyer(`/api/chantiers/${chantier.corps.id}`, { statut: 'termine' }, 'PATCH');
  assert.equal(cloture.corps.statut, 'termine');
  const detail = await (await fetch(`${url}/api/factures/${facture.corps.id}`)).json();
  assert.equal(detail.lignes.length, 2);
  assert.equal(detail.reglements.length, 2);
  assert.equal(detail.montant_regle, 2000000);
});