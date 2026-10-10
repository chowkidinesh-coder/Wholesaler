// Two small adapters give the app one database interface:
//   db.query(sql, params) -> { rows }      db.exec(sql) -> runs several statements      db.tx(fn) -> fn(q) inside one transaction
// "pg" talks to the real PostgreSQL; "pglite" (PostgreSQL in memory) is used by the automatic tests.
const fs = require('fs');
const path = require('path');

function pgAdapter(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, max: 10 });
  return {
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((sql, params) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* the original error matters more */ }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function pgliteAdapter(pglite) {
  return {
    query: (sql, params) => pglite.query(sql, params),
    exec: (sql) => pglite.exec(sql),
    tx: (fn) => pglite.transaction((t) => fn((sql, params) => t.query(sql, params))),
    close: () => pglite.close(),
  };
}

async function applySchema(db) {
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));
}

module.exports = { pgAdapter, pgliteAdapter, applySchema };
