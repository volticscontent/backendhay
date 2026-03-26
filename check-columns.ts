import { query } from './src/lib/db';
async function main() {
  try {
    const resLeads = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'leads'");
    console.log("Leads Columns:", resLeads.rows.map(r => r.column_name));
    
    const resEmpresarial = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'leads_empresarial'");
    console.log("Leads Empresarial Columns:", resEmpresarial.rows.map(r => r.column_name));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
main();
