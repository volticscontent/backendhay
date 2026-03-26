import { query } from './src/lib/db';
async function main() {
  try {
    const res = await query("SELECT l.telefone FROM leads_empresarial le JOIN leads l ON l.id = le.lead_id WHERE le.cnpj = '14511139000104'");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
main();
