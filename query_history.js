const pg = require('pg');
require('dotenv').config({ path: '.env' });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const res = await pool.query("SELECT * FROM chat_history WHERE phone LIKE '%3193442672%' OR phone LIKE '%3182354127%' ORDER BY created_at DESC LIMIT 15");
    console.log('Recent messages:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
