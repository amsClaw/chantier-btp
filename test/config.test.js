import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  DEVISE_PAR_DEFAUT,
  configurationPublique,
  resolveCurrencySymbol,
} from '../src/config.js';
import { DEFAULT_PORT, resolvePort, startServer } from '../src/server.js';
import {
  DEVISE_PAR_DEFAUT as DEVISE_CLIENT,
  definirDevise,
  deviseCourante,
  montant,
} from '../public/app.js';

const executer = promisify(execFile);
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Démarre un serveur réel (port 0 + base temporaire) et rend son URL. */
async function demarrerServeur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-config-'));
  const instance = startServer({ port: 0, dbPath: path.join(dir, 'data', 'chantier.sqlite') });
  if (!instance.server.listening) await once(instance.server, 'listening');
  return instance;
}

/** Exécute `action` avec `CURRENCY_SYMBOL` posé, puis restaure l'environnement d'origine. */
async function avecSymbole(valeur, action) {
  const sauvegarde = process.env.CURRENCY_SYMBOL;
  if (valeur === undefined) delete process.env.CURRENCY_SYMBOL;
  else process.env.CURRENCY_SYMBOL = valeur;
  try {
    return await action();
  } finally {
    if (sauvegarde === undefined) delete process.env.CURRENCY_SYMBOL;
    else process.env.CURRENCY_SYMBOL = sauvegarde;
  }
}

/* --- Résolution de CURRENCY_SYMBOL ----------------------------------------- */
test('CURRENCY_SYMBOL vaut GNF par défaut, et toute valeur non vide est retenue', () => {
  const sauvegarde = process.env.CURRENCY_SYMBOL;
  try {
    delete process.env.CURRENCY_SYMBOL;
    assert.equal(DEVISE_PAR_DEFAUT, 'GNF');
    assert.equal(resolveCurrencySymbol(), 'GNF');

    process.env.CURRENCY_SYMBOL = '€';
    assert.equal(resolveCurrencySymbol(), '€');

    // Valeur vide ou espaces : on retombe sur le défaut, jamais sur un montant nu.
    process.env.CURRENCY_SYMBOL = '   ';
    assert.equal(resolveCurrencySymbol(), 'GNF');

    // La valeur explicite prime sur l'environnement.
    assert.equal(resolveCurrencySymbol('FCFA'), 'FCFA');
    assert.equal(configurationPublique().currency_symbol, 'GNF');
  } finally {
    if (sauvegarde === undefined) delete process.env.CURRENCY_SYMBOL;
    else process.env.CURRENCY_SYMBOL = sauvegarde;
  }
});

test('GET /api/config renvoie la devise de l’instance', async (t) => {
  const instance = await avecSymbole(undefined, demarrerServeur);
  t.after(() => instance.close());

  const res = await fetch(`${instance.url}/api/config`);

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { produit: 'chantier-btp', currency_symbol: 'GNF' });
});

test('la page d’accueil est servie avec le symbole CURRENCY_SYMBOL interpolé', async (t) => {
  const instance = await avecSymbole('€', demarrerServeur);
  await avecSymbole('€', async () => {
    t.after(() => instance.close());

    const configuration = await (await fetch(`${instance.url}/api/config`)).json();
    assert.equal(configuration.currency_symbol, '€');

    const page = await (await fetch(`${instance.url}/`)).text();
    assert.match(page, /data-devise="€"/, 'la page servie doit porter la devise de l’instance');
    assert.doesNotMatch(page, /\{\{CURRENCY_SYMBOL\}\}/, 'le jeton de devise doit être substitué');
    // Le client reprend la valeur pour l'afficher (definirDevise, testé ci-dessus).
    assert.match(page, /id="devise-app"/);
    assert.match(page, /<script type="module" src="public\/app\.js"><\/script>/);
  });
});

test('l’interface reprend la devise renvoyée par l’API sans reconstruire la page', () => {
  try {
    assert.equal(DEVISE_CLIENT, 'GNF');
    assert.equal(definirDevise('GNF'), 'GNF');
    assert.equal(montant(1500000).replace(/\u202f|\u00a0/g, ' '), '1 500 000 GNF');

    definirDevise('€');
    assert.equal(deviseCourante(), '€');
    assert.equal(montant(1500000).replace(/\u202f|\u00a0/g, ' '), '1 500 000 €');

    // Valeur vide : le symbole courant est conservé.
    definirDevise('  ');
    assert.equal(deviseCourante(), '€');
  } finally {
    definirDevise('GNF');
  }
});

test('definirDevise met à jour le bandeau supérieur quand le DOM est présent', () => {
  const bloc = { textContent: 'GNF' };
  globalThis.document = { getElementById: (id) => (id === 'devise-app' ? bloc : null) };
  try {
    definirDevise('€');
    assert.equal(bloc.textContent, '€');
    assert.equal(deviseCourante(), '€');
  } finally {
    delete globalThis.document;
    definirDevise('GNF');
  }
});

/* --- PORT et DB_PATH ------------------------------------------------------- */
test('resolvePort accepte l’explicite, l’environnement PORT, sinon 8080', () => {
  const sauvegarde = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(DEFAULT_PORT, 8080);
    assert.equal(resolvePort(), 8080);
    assert.equal(resolvePort(0), 0, 'le port 0 doit rester possible (tests, seed)');
    assert.equal(resolvePort(9000), 9000);

    process.env.PORT = '9090';
    assert.equal(resolvePort(), 9090);

    process.env.PORT = 'pas-un-port';
    assert.equal(resolvePort(), DEFAULT_PORT);
  } finally {
    if (sauvegarde === undefined) delete process.env.PORT;
    else process.env.PORT = sauvegarde;
  }
});

test('DB_PATH de l’environnement est utilisé quand startServer n’en reçoit pas', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-env-'));
  const chemin = path.join(dir, 'variable-env', 'chantier.sqlite');
  const sauvegarde = process.env.DB_PATH;
  process.env.DB_PATH = chemin;

  let instance = null;
  t.after(async () => {
    if (instance) await instance.close();
    if (sauvegarde === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = sauvegarde;
  });

  instance = startServer({ port: 0 });
  if (!instance.server.listening) await once(instance.server, 'listening');

  assert.ok(fs.existsSync(chemin), `base attendue au chemin DB_PATH ${chemin}`);
  assert.equal((await fetch(`${instance.url}/health`)).status, 200);
});

test('`PORT=… npm start` fait écouter le serveur sur le port demandé', async (t) => {
  // Port libre attribué par l'OS, puis relâché : le serveur lancé en sous-processus
  // doit s'y attacher, ce qui prouve que PORT est bien lu au démarrage.
  const sonde = startServer({ port: 0, dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-port-')), 'chantier.sqlite') });
  if (!sonde.server.listening) await once(sonde.server, 'listening');
  const port = sonde.port;
  await sonde.close();

  const enfant = executer(process.execPath, ['src/server.js'], {
    cwd: RACINE,
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(os.tmpdir(), `chantier-btp-port-${port}.sqlite`) },
    timeout: 15000,
  });
  t.after(() => enfant.child.kill('SIGTERM'));

  let statut = 0;
  for (let essai = 0; essai < 40 && statut !== 200; essai += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    statut = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.status).catch(() => 0);
  }
  assert.equal(statut, 200, `le serveur devait répondre sur PORT=${port}`);

  // Le serveur gère SIGTERM : il rend la main proprement.
  enfant.child.kill('SIGTERM');
  const { stdout } = await enfant;
  assert.match(stdout, new RegExp(`Serveur démarré sur http://localhost:${port}`));
});

/* --- Aucun chemin absolu codé en dur --------------------------------------- */
test('aucun chemin absolu de poste n’est codé en dur dans les sources', () => {
  // Motifs reconstruits pour que ce test ne se détecte pas lui-même.
  const motifs = [`${'/Us'}ers/`, `${'/ho'}me/`];
  const extensions = new Set(['.js', '.json', '.html', '.css', '.md', '.yml']);
  const ignores = new Set(['node_modules', '.git', '.worktrees', 'test', 'data']);

  const fautifs = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (entree.isDirectory()) {
        if (!ignores.has(entree.name)) parcourir(path.join(dossier, entree.name));
        continue;
      }
      if (!extensions.has(path.extname(entree.name))) continue;
      const contenu = fs.readFileSync(path.join(dossier, entree.name), 'utf8');
      if (motifs.some((motif) => contenu.includes(motif))) fautifs.push(entree.name);
    }
  };
  parcourir(RACINE);

  assert.deepEqual(fautifs, [], `chemins absolus trouvés dans : ${fautifs.join(', ')}`);
});
