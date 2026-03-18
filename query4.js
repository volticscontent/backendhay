const pg = require('pg');
require('dotenv').config({ path: '.env' });

console.log('DB URL:', process.env.DATABASE_URL);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const res = await pool.query("SELECT id, telefone, nome_completo, situacao, data_cadastro FROM leads WHERE situacao = 'nao_respondido'");
    console.log('Unanswered leads:', res.rows);
    
    const res2 = await pool.query("SELECT * FROM leads_atendimento ORDER BY data_followup DESC LIMIT 5");
    console.log('Atendimentos recent:', res2.rows);

    const res3 = await pool.query("SELECT id, telefone, nome_completo FROM leads WHERE telefone LIKE '%3182354127%' OR telefone LIKE '%31982354127%' OR telefone LIKE '%3193442672%'");
    console.log('Phones match user:', res3.rows);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
