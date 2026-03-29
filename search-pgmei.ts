import * as dotenv from 'dotenv';
import path from 'path';
import { consultarServico } from './src/lib/serpro';

// Carrega as credenciais do .env (deve estar em bot-backend)
dotenv.config({ path: path.join(__dirname, '.env') });

const CNPJ = '45175209000124'; // CNPJ solicitado

async function searchPGMEI() {
    console.log(`🔍 Pesquisando CNPJ ${CNPJ} no PGMEI (Serpro)...\n`);
    
    try {
        // PGMEI no Integra Contador permite consultar extratos e gerar DAS
        // Usamos o ID que validamos na documentação: sistema PGMEI, servico DIVIDAATIVA24 (ou similar)
        // Se o objetivo for apenas o extrato PGMEI, podemos usar o serviço PGMEI padrão.
        
        const result = await consultarServico('DIVIDA_ATIVA', CNPJ, {
            ano: new Date().getFullYear().toString()
        });

        console.log('✅ Resultado da Consulta:');
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('❌ Erro na consulta:', error instanceof Error ? error.message : error);
    }
}

searchPGMEI();
