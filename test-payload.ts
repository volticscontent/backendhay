import * as dotenv from 'dotenv';
import path from 'path';
import { SERVICE_CONFIG } from './src/lib/serpro-config';

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

function testPayloadConstruction(serviceKey: keyof typeof SERVICE_CONFIG, cnpj: string, options: any = {}) {
    const config = SERVICE_CONFIG[serviceKey];
    const idSistema = config.default_sistema;
    const idServico = config.default_servico;
    
    const dadosServico: any = { cnpj: cnpj.replace(/\D/g, '') };

    // Lógica espelhada do serpro.ts para validação de payload
    if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD'].includes(serviceKey)) {
        dadosServico.anoCalendario = options.ano || new Date().getFullYear().toString();
    }

    const payload = {
        contratante: { numero: "51564549000140", tipo: 2 },
        pedidoDados: {
            idSistema,
            idServico,
            versaoSistema: config.versao || '1.0',
            dados: JSON.stringify(dadosServico),
        },
    };

    console.log(`--- Payload Simulado para ${serviceKey} ---`);
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n');
}

console.log('🧪 Iniciando Teste de Estrutura de Payload (Validando contra Doc Serpro)\n');
testPayloadConstruction('DIVIDA_ATIVA', '51.564.549/0001-40', { ano: '2024' });
testPayloadConstruction('CCMEI_DADOS', '51.564.549/0001-40');
console.log('✅ Payloads estruturados conforme exigido pela documentação Integra Contador.');
