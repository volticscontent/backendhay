const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool();

async function run() {
  try {
    const res = await pool.query("SELECT id, telefone, nome_completo, situacao, data_cadastro FROM leads WHERE situacao = 'nao_respondido'");
    console.log('Unanswered leads:', res.rows);
    
    const res2 = await pool.query('SELECT lead_id, data_followup FROM leads_atendimento');
    console.log('Atendimentos:', res2.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
