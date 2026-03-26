"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const evolution_1 = require("../lib/evolution");
const logger_1 = require("../lib/logger");
/**
 * Script para desativar o webhook da instância
 * Útil agora que migramos para WebSocket
 */
async function disableWebhook() {
    logger_1.evolutionLogger.info('🔌 Desativando webhook para limpar fluxo...');
    try {
        await (0, evolution_1.evolutionSetWebhook)({
            enabled: false,
            url: 'http://localhost:3001/api/webhook/whatsapp' // Obrigatório mesmo desabilitado
        });
        logger_1.evolutionLogger.info('✅ Webhook desativado com sucesso!');
        logger_1.evolutionLogger.info('💡 Agora o backend receberá mensagens exclusivamente via WebSocket.');
    }
    catch (error) {
        logger_1.evolutionLogger.error('❌ Erro ao desativar webhook:', error.message);
        process.exit(1);
    }
}
disableWebhook();
//# sourceMappingURL=disable-webhook.js.map