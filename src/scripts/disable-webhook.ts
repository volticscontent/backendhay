import 'dotenv/config';
import { evolutionSetWebhook } from '../lib/evolution';
import { evolutionLogger } from '../lib/logger';

/**
 * Script para desativar o webhook da instância
 * Útil agora que migramos para WebSocket
 */
async function disableWebhook() {
    evolutionLogger.info('🔌 Desativando webhook para limpar fluxo...');

    try {
        await evolutionSetWebhook({
            enabled: false,
            url: 'http://localhost:3001/api/webhook/whatsapp' // Obrigatório mesmo desabilitado
        });

        evolutionLogger.info('✅ Webhook desativado com sucesso!');
        evolutionLogger.info('💡 Agora o backend receberá mensagens exclusivamente via WebSocket.');

    } catch (error: any) {
        evolutionLogger.error('❌ Erro ao desativar webhook:', error.message);
        process.exit(1);
    }
}

disableWebhook();
