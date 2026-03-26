"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const evolution_1 = require("../lib/evolution");
const logger_1 = require("../lib/logger");
/**
 * Script para aplicar as melhores práticas de estabilidade na Evolution API
 * baseadas nas recomendações de atualização do WhatsApp/Baileys.
 */
async function configureInstance() {
    logger_1.evolutionLogger.info('🚀 Iniciando configuração de estabilidade da instância...');
    try {
        // 1. Verificar estado atual
        const state = await (0, evolution_1.evolutionGetConnectionState)();
        logger_1.evolutionLogger.info(`Estado atual da instância: ${state?.instance?.state || 'Desconhecido'}`);
        // 2. Aplicar Configurações de Comportamento
        logger_1.evolutionLogger.info('⚙️ Aplicando configurações de comportamento (Always Online, Reject Call)...');
        await (0, evolution_1.evolutionUpdateInstanceSettings)({
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
        logger_1.evolutionLogger.info('⚙️ Ativando persistência de mensagens no Banco de Dados (SaveData)...');
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
        logger_1.evolutionLogger.info('✅ Configurações de comportamento aplicadas com sucesso!');
        logger_1.evolutionLogger.info('ℹ️ Nota: As configurações de Hardware (Chrome/Windows) devem ser mantidas no .env do servidor Evolution API conforme configurado no Easy Panel.');
    }
    catch (error) {
        logger_1.evolutionLogger.error('❌ Erro ao configurar instância:', error.message);
        process.exit(1);
    }
}
configureInstance();
//# sourceMappingURL=configure-instance.js.map