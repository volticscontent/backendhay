import { query } from './src/lib/db';
import { checkCnpjSerpro } from './src/ai/server-tools';

async function main() {
  try {
    console.log("Buscando CNPJs no banco de dados...");
    const res = await query(`
      SELECT cnpj FROM consultas_serpro 
      WHERE resultado->>'situacao' IS NOT NULL OR resultado->>'nomeEmpresarial' IS NOT NULL OR resultado->>'ni' IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `);
    
    if (res.rows.length === 0) {
      console.log("Nenhum CNPJ válido encontrado em consultas_serpro.");
      process.exit(0);
    }
    
    const row = res.rows[0];
    console.log(`Testando CNPJ: ${row.cnpj}`);
    
    const result = await checkCnpjSerpro(row.cnpj as string, 'CCMEI_DADOS');
    console.log("Resultado da consulta Serpro:", result);
    
  } catch (err) {
    console.error("Erro:", err);
  } finally {
    process.exit(0);
  }
}

main();
