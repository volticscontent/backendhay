import { io, Socket } from 'socket.io-client';
import { processIncomingMessage } from './message-processor';
import { evolutionLogger } from './logger';

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || '';

let socket: Socket | null = null;

/**
 * Inicializa a conexão WebSocket com a Evolution API
 */
export function initEvolutionWebSocket() {
    if (socket) return socket;

    evolutionLogger.info(`🔌 Conectando ao WebSocket da Evolution API: ${EVOLUTION_API_URL}`);

    socket = io(EVOLUTION_API_URL, {
        query: {
            apikey: EVOLUTION_API_KEY
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
        evolutionLogger.info('✅ Conectado ao WebSocket da Evolution API');
    });

    socket.on('disconnect', (reason) => {
        evolutionLogger.warn(`❌ Desconectado do WebSocket da Evolution API. Motivo: ${reason}`);
    });

    socket.on('connect_error', (error) => {
        evolutionLogger.error('Erro na conexão WebSocket da Evolution API:', error.message);
    });

    // Escutar eventos de mensagens
    socket.on('messages.upsert', async (payload: any) => {
        // Filtrar apenas a instância configurada, se necessário (Evolution pode enviar de todas as instâncias daquela apikey)
        if (payload.instance && payload.instance !== EVOLUTION_INSTANCE_NAME) {
            return;
        }

        try {
            await processIncomingMessage(payload);
        } catch (err) {
            evolutionLogger.error('Erro ao processar mensagem via WebSocket:', err);
        }
    });

    // Outros eventos úteis
    socket.on('connection.update', (data: any) => {
        if (data.instance === EVOLUTION_INSTANCE_NAME) {
            evolutionLogger.info(`📡 Evolução: Atualização de conexão [${data.data?.state || 'unknown'}]`);
        }
    });

    return socket;
}

export function getEvolutionSocket() {
    return socket;
}
