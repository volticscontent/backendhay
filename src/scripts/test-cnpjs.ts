/**
 * Script de teste para verificar os CNPJs específicos solicitados
 */

import 'dotenv/config';
import { cnpjService } from '../lib/cnpj-service';
import { query } from '../lib/db';
import { saveConsultation } from '../lib/serpro-db';

const cnpjsParaTestar = [
  '45.723.564/0001-90',
  '45.175.209/0001-24',
  '14.511.139/0001-04',
  '37.418.796/0001-07'
];

async function testarCNPJs() {
  console.log('🧪 Iniciando teste de CNPJs específicos...\n');

  for (const cnpj of cnpjsParaTestar) {
    console.log(`📋 Testando CNPJ: ${cnpj}`);
    
    try {
      const resultado = await cnpjService.consultarCNPJ(cnpj);
      
      if (resultado.success) {
        console.log(`✅ CNPJ VÁLIDO`);
        console.log(`   Razão Social: ${resultado.data?.razao_social}`);
        console.log(`   Nome Fantasia: ${resultado.data?.nome_fantasia || 'N/A'}`);
        console.log(`   Situação: ${resultado.data?.situacao_cadastral}`);
        console.log(`   Fonte: ${resultado.api_source}`);
        console.log(`   Cache: ${resultado.cached ? 'Sim' : 'Não'}`);

        // Persistir para aparecer nas consultas de teste no painel
        try {
          const cleanCnpj = cnpj.replace(/\D/g, '');
          const leadRow = await query(
            `SELECT id FROM leads WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1 LIMIT 1`,
            [cleanCnpj],
          );
          const leadId = (leadRow.rows[0]?.id as number | undefined) ?? null;
          
          // Salva como 'test' source para aparecer na aba de testes
          await saveConsultation(cleanCnpj, 'CNPJ_API', resultado.data, 200, 'test', leadId);
          console.log(`   📌 Salvo no histórico de consultas de teste`);
        } catch (dbError) {
          console.error(`   ⚠️ Erro ao salvar no histórico: ${dbError}`);
        }
      } else {
        console.log(`❌ CNPJ INVÁLIDO`);
        console.log(`   Erro: ${resultado.error?.message}`);
        console.log(`   Código: ${resultado.error?.code}`);
      }
      
      console.log(''); // Linha em branco
      
      // Pequeno delay entre consultas para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`❌ ERRO AO CONSULTAR: ${error}`);
      console.log('');
    }
  }

  // Estatísticas do cache
  const stats = cnpjService.getCacheStats();
  console.log('📊 Estatísticas do Cache:');
  console.log(`   Tamanho do cache: ${stats.size} itens`);
  
  console.log('\n✅ Teste concluído!');
}

// Executa o teste se este arquivo for executado diretamente
if (require.main === module) {
  testarCNPJs().catch(console.error);
}

export { testarCNPJs };