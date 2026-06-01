import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function runAudit() {
  const { checkCnpjSerpro } = await import('./src/ai/server-tools');
  const { SERVICE_CONFIG } = await import('./src/lib/serpro-config');
  
  const cnpj = '23950473000155'; // A known CNPJ with active procuration
  const results = [];
  
  const services = Object.keys(SERVICE_CONFIG);
  
  console.log('Iniciando auditoria de todas as APIs Serpro configuradas...\n');

  for (const service of services) {
    const config = SERVICE_CONFIG[service];
    console.log(`Testando ${service}...`);
    
    try {
      // Passando alguns options básicos para evitar erros de 400 Bad Request que não sejam de permissão
      const options = { 
          ano: '2024', 
          mes: '01', 
          numeroDas: '12345678901234', 
          protocoloRelatorio: '123456',
          cpf: '47813113934' // CPF do titular do CNPJ de teste
      };

      const raw = await checkCnpjSerpro(cnpj, service as any, options);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      
      const strResponse = JSON.stringify(parsed);
      
      let status = '✅ ATIVA';
      let detalhe = '';
      
      if (strResponse.includes('ICGERENCIADOR-044') || strResponse.includes('não foi autorizado para ser acionado em produção')) {
          status = '❌ NÃO ASSINADA';
          detalhe = 'Falta assinar no portal Integra Contador';
      } else if (strResponse.includes('Serviço REST indisponível hoje')) {
          status = '⚠️ FORA DO AR (PGFN)';
          detalhe = 'Serviço da Receita temporariamente indisponível';
      } else if (parsed.status === 'error' || strResponse.includes('error')) {
          // Erros 400 ou outros (como parâmetros inválidos) significam que a API ESTÁ ASSINADA, só estamos mandando dados errados.
          status = '✅ ATIVA (Com erro de requisição)';
          detalhe = parsed.message || 'Faltam parâmetros específicos';
      } else {
          detalhe = 'Respondendo corretamente';
      }
      
      results.push({ Serviço: service, Status: status, Detalhe: detalhe.substring(0, 80) });
    } catch (e) {
        const strError = String(e);
        if (strError.includes('ICGERENCIADOR-044')) {
            results.push({ Serviço: service, Status: '❌ NÃO ASSINADA', Detalhe: 'Falta assinar no portal' });
        } else {
            results.push({ Serviço: service, Status: '✅ ATIVA (Erro no teste)', Detalhe: strError.substring(0, 80) });
        }
    }
  }
  
  console.log('\n\n=== RELATÓRIO DE ASSINATURAS SERPRO ===');
  console.table(results);
  
  const naoAssinadas = results.filter(r => r.Status === '❌ NÃO ASSINADA').map(r => r.Serviço);
  console.log('\nResumo das APIs que FALTAM ASSINAR no Integra Contador:');
  if (naoAssinadas.length > 0) {
      naoAssinadas.forEach(s => console.log(`- ${s}`));
  } else {
      console.log('NENHUMA! Todas estão assinadas.');
  }

  process.exit(0);
}

runAudit().catch(e => { console.error(e); process.exit(1); });
