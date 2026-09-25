import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_DB_PATH, openDatabase, resolveDbPath } from '../src/db.js';

test('resolveDbPath retombe sur ./data/chantier.sqlite, DB_PATH prioritaire', () => {
  const saved = process.env.DB_PATH;
  try {
    delete process.env.DB_PATH;
    assert.equal(DEFAULT_DB_PATH, './data/chantier.sqlite');
    assert.equal(resolveDbPath(), DEFAULT_DB_PATH);
    assert.equal(resolveDbPath('/tmp/explicite.sqlite'), '/tmp/explicite.sqlite');

    process.env.DB_PATH = '/tmp/variable-env.sqlite';
    assert.equal(resolveDbPath(), '/tmp/variable-env.sqlite');
  } finally {
    if (saved === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = saved;
  }
});

test('openDatabase crée le répertoire parent manquant et ouvre la base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-btp-db-'));
  const dbPath = path.join(dir, 'niveau1', 'niveau2', 'chantier.sqlite');

  const db = openDatabase(dbPath);
  try {
    assert.ok(fs.existsSync(dbPath));
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.deepEqual(db.prepare('select 1 as ok').get(), { ok: 1 });
  } finally {
    db.close();
  }
});
