/**
 * Script de teste para os endpoints de CNPJ
 * Executar com: node test-cnpj-api.mjs
 */

import http from 'http';

// CNPJs para testar
const cnpjsParaTestar = [
  '45.723.564/0001-90',
  '45.175.209/0001-24',
  '14.511.139/0001-04',
  '37.418.796/0001-07'
];

// Função para fazer requisições HTTP
function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: parsedData });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Função principal de teste
async function testarAPI() {
  console.log('🧪 Iniciando teste da API de CNPJ...\n');

  // Testa endpoint de validação
  console.log('📋 Testando endpoint de validação...');
  for (const cnpj of cnpjsParaTestar) {
    try {
      const response = await makeRequest(`/api/cnpj/validate`, 'POST', { cnpj });
      console.log(`CNPJ: ${cnpj}`);
      console.log(`Válido: ${response.data.valid}`);
      console.log(`Formatado: ${response.data.formatted}`);
      console.log('');
    } catch (error) {
      console.log(`Erro ao validar ${cnpj}: ${error.message}`);
    }
  }

  // Testa endpoint de consulta individual
  console.log('🔍 Testando endpoint de consulta individual...');
  for (const cnpj of cnpjsParaTestar) {
    try {
      const cleanCNPJ = cnpj.replace(/[^\d]/g, '');
      const response = await makeRequest(`/api/cnpj/${cleanCNPJ}`);
      
      if (response.data.success) {
        console.log(`✅ ${cnpj} - ${response.data.data.razao_social}`);
        console.log(`   Situação: ${response.data.data.situacao_cadastral}`);
        console.log(`   Fonte: ${response.data.api_source}`);
        console.log(`   Cache: ${response.data.cached ? 'Sim' : 'Não'}`);
      } else {
        console.log(`❌ ${cnpj} - Erro: ${response.data.error?.message}`);
      }
      console.log('');
      
      // Pequeno delay entre consultas
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.log(`Erro ao consultar ${cnpj}: ${error.message}`);
    }
  }

  // Testa endpoint de lote
  console.log('📦 Testando endpoint de lote...');
  try {
    const cleanCNPJs = cnpjsParaTestar.map(cnpj => cnpj.replace(/[^\d]/g, ''));
    const response = await makeRequest('/api/cnpj/batch', 'POST', { cnpjs: cleanCNPJs });
    
    if (response.data.success) {
      console.log(`Resultados do lote:`);
      console.log(`Total: ${response.data.statistics.total}`);
      console.log(`Sucesso: ${response.data.statistics.successful}`);
      console.log(`Falhas: ${response.data.statistics.failed}`);
      console.log(`Cache: ${response.data.statistics.cached}`);
      
      response.data.results.forEach((result, index) => {
        const cnpj = cnpjsParaTestar[index];
        if (result.success) {
          console.log(`✅ ${cnpj} - ${result.data.razao_social}`);
        } else {
          console.log(`❌ ${cnpj} - ${result.error?.message}`);
        }
      });
    } else {
      console.log(`Erro no lote: ${response.data.error?.message}`);
    }
  } catch (error) {
    console.log(`Erro ao testar lote: ${error.message}`);
  }

  console.log('\n✅ Teste da API concluído!');
}

// Executa o teste
testarAPI().catch(console.error);