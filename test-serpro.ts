import * as dotenv from 'dotenv';
import path from 'path';
import { consultarServico } from './src/lib/serpro';
import { SERVICE_CONFIG } from './src/lib/serpro-config';

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

async function runTests() {
    console.log('🚀 Iniciando Testes de Integração Serpro (Integra Contador)\n');

    const testCnpj = '51564549000140'; // CNPJ para teste
    const servicesToTest: (keyof typeof SERVICE_CONFIG)[] = ['CCMEI_DADOS', 'DIVIDA_ATIVA'];

    for (const service of servicesToTest) {
        console.log(`--- Testando Serviço: ${service} ---`);
        try {
            const result = await consultarServico(service, testCnpj, {
                ano: new Date().getFullYear().toString()
            });
            
            console.log('✅ Sucesso na Resposta!');
            console.log('Resultado (resumo):', JSON.stringify(result).substring(0, 500) + '...');
        } catch (error) {
            console.error(`❌ Erro no serviço ${service}:`, error instanceof Error ? error.message : error);
        }
        console.log('\n');
    }

    console.log('🏁 Testes concluídos.');
}

runTests().catch(err => {
    console.error('💥 Erro fatal nos testes:', err);
    process.exit(1);
});
