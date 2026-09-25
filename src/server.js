import { pathToFileURL } from 'node:url';

import { createApp } from './app.js';
import { openDatabase } from './db.js';

export const DEFAULT_PORT = 8080;

/**
 * Démarre le serveur HTTP.
 *
 * - port : `process.env.PORT` si défini, sinon 8080 (0 = port libre attribué
 *   par l'OS, utilisé par les tests).
 * - dbPath : `process.env.DB_PATH` si défini, sinon `./data/chantier.sqlite`.
 *
 * Renvoie `{ app, db, server, port, url, close }` pour que les tests puissent
 * piloter le cycle de vie sans tuer le processus.
 */
export function startServer({ port, dbPath } = {}) {
  const chosenPort = port ?? (Number(process.env.PORT) || DEFAULT_PORT);

  const db = openDatabase(dbPath);
  const app = createApp({ db });
  const server = app.listen(chosenPort);

  return {
    app,
    db,
    server,
    get port() {
      const address = server.address();
      return address && typeof address === 'object' ? address.port : chosenPort;
    },
    get url() {
      const address = server.address();
      const actual = address && typeof address === 'object' ? address.port : chosenPort;
      return `http://127.0.0.1:${actual}`;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          try {
            db.close();
          } catch {
            /* base déjà fermée : sans conséquence à l'arrêt */
          }
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

/** Vrai quand ce module est le point d'entrée (`node src/server.js`). */
function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const instance = startServer();
  instance.server.on('listening', () => {
    console.log(`Serveur démarré sur http://localhost:${instance.port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      instance.close().finally(() => process.exit(0));
    });
  }
}
