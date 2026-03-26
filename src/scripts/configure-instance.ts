import 'dotenv/config';
import { 
    evolutionUpdateInstanceSettings, 
    evolutionGetConnectionState 
} from '../lib/evolution';
import { evolutionLogger } from '../lib/logger';

/**
 * Script para aplicar as melhores práticas de estabilidade na Evolution API
 * baseadas nas recomendações de atualização do WhatsApp/Baileys.
 */
async function configureInstance() {
    evolutionLogger.info('🚀 Iniciando configuração de estabilidade da instância...');

    try {
        // 1. Verificar estado atual
        const state: any = await evolutionGetConnectionState();
        evolutionLogger.info(`Estado atual da instância: ${state?.instance?.state || 'Desconhecido'}`);

        // 2. Aplicar Configurações de Comportamento
        evolutionLogger.info('⚙️ Aplicando configurações de comportamento (Always Online, Reject Call)...');
        await evolutionUpdateInstanceSettings({
            alwaysOnline: true,
            rejectCall: true,
            msgCall: 'Desculpe, este número não aceita chamadas de voz/vídeo. Por favor, envie uma mensagem de texto.',
            groupsIgnore: true,
            readMessages: false,
            readStatus: false,
            syncFullHistory: false,
            reconnectNetwork: true,
            reconnectOnError: true,
        });

        evolutionLogger.info('⚙️ Ativando persistência de mensagens no Banco de Dados (SaveData)...');
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'teste';
        const apiKey = process.env.EVOLUTION_API_KEY;
        const apiUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
        
        await fetch(`${apiUrl}/chat/updateSaveData/${instanceName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': String(apiKey)
            },
            body: JSON.stringify({
                message: true,
                contacts: true,
                chats: true,
                labels: true,
                historic: false
            })
        });

        evolutionLogger.info('✅ Configurações de comportamento aplicadas com sucesso!');
        evolutionLogger.info('ℹ️ Nota: As configurações de Hardware (Chrome/Windows) devem ser mantidas no .env do servidor Evolution API conforme configurado no Easy Panel.');

    } catch (error: any) {
        evolutionLogger.error('❌ Erro ao configurar instância:', error.message);
        process.exit(1);
    }
}

configureInstance();
