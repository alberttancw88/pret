// Runs a supabase/tests/*.sql file against the database in DATABASE_URL over VERIFIED TLS and
// prints its result rows (test, pass, detail). The SQL files roll themselves back.
//   DATABASE_CA_CERT_FILE=/path/to/supabase-root-ca.pem node --env-file=.env.local supabase/tests/run.cjs supabase/tests/foundation_role_matrix.sql
// Never prints the connection string.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require(path.join(process.cwd(), 'node_modules/pg'));

(async () => {
  const file = process.argv[2];
  if (!file || !process.env.DATABASE_URL || !process.env.DATABASE_CA_CERT_FILE) {
    console.error('usage: DATABASE_URL=… DATABASE_CA_CERT_FILE=… node supabase/tests/run.cjs <file.sql>');
    process.exit(2);
  }
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const client = new Client({
    connectionString: url.toString(),
    ssl: { ca: fs.readFileSync(process.env.DATABASE_CA_CERT_FILE, 'utf8'), rejectUnauthorized: true },
  });
  await client.connect();
  let failed = 0;
  try {
    const res = await client.query(fs.readFileSync(file, 'utf8'));
    for (const r of Array.isArray(res) ? res : [res]) {
      if (r.command !== 'SELECT') continue;
      for (const row of r.rows) {
        if ('test' in row) console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.test}${row.pass ? '' : `  -> ${row.detail}`}`);
        else if ('passed' in row) { console.log(`SUMMARY passed=${row.passed} failed=${row.failed}`); failed = Number(row.failed); }
      }
    }
  } catch (e) {
    console.log('ERROR', e.message);
    failed = 1;
    try { await client.query('rollback'); } catch {}
  }
  await client.end();
  process.exit(failed ? 1 : 0);
})();
