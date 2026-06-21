import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
    const { default: pool } = await import('./src/lib/db');
    const res = await pool.query(`SELECT COUNT(*) as total_leads, COUNT(cnpj) as com_cnpj, COUNT(DISTINCT cnpj) as cnpjs_unicos FROM leads`);
    console.log('Totais:', JSON.stringify(res.rows[0]));
    const res2 = await pool.query(`SELECT DISTINCT l.cnpj, l.nome_completo, l.situacao, lp.procuracao_ativa FROM leads l LEFT JOIN leads_processo lp ON lp.lead_id = l.id WHERE l.cnpj IS NOT NULL AND l.cnpj != '' ORDER BY lp.procuracao_ativa DESC NULLS LAST`);
    console.log('CNPJs:', JSON.stringify(res2.rows, null, 2));
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
