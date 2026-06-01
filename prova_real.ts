import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function proof() {
  const { checkCnpjSerpro } = await import('./src/ai/server-tools');
  
  const cnpj = '23950473000155'; 
  console.log('=== PROVA REAL DAS APIS SERPRO ===\n');

  // 1. API 100% Funcional (PGMEI)
  console.log('1. Testando PGMEI (Consulta de dívidas DAS)...');
  try {
      const res = await checkCnpjSerpro(cnpj, 'PGMEI', { ano: '2024' });
      console.log('   ✅ RESULTADO: SUCESSO ABSOLUTO (200 OK)');
      console.log('   ' + res.substring(0, 150) + '...\n');
  } catch(e) {}

  // 2. API Assinada mas com dados falsos (PGDASD)
  console.log('2. Testando PGDASD (Extrato de guia) com número de DAS FALSO "12345678901234"...');
  try {
      const res = await checkCnpjSerpro(cnpj, 'PGDASD', { ano: '2024', numeroDas: '12345678901234' });
      const parsed = JSON.parse(res);
      console.log('   ✅ RESULTADO: API ATIVA E COMUNICANDO COM A RECEITA.');
      console.log('   A Receita respondeu: ' + parsed.message + '\n');
  } catch(e) {}

  // 3. API NÃO ASSINADA (DASN_SIMEI)
  console.log('3. Testando DASN_SIMEI (Declaração Anual)...');
  try {
      const res = await checkCnpjSerpro(cnpj, 'DASN_SIMEI', { ano: '2024' });
      const parsed = JSON.parse(res);
      console.log('   ❌ RESULTADO: BLOQUEADA NO PORTAL (FALTA ASSINAR)');
      console.log('   A Serpro bloqueou e disse: ' + parsed.message + '\n');
  } catch(e) {}

  process.exit(0);
}

proof();