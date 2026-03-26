"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEvolutionWebSocket = initEvolutionWebSocket;
exports.getEvolutionSocket = getEvolutionSocket;
const socket_io_client_1 = require("socket.io-client");
const message_processor_1 = require("./message-processor");
const logger_1 = require("./logger");
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || '';
let socket = null;
/**
 * Inicializa a conexão WebSocket com a Evolution API
 */
function initEvolutionWebSocket() {
    if (socket)
        return socket;
    logger_1.evolutionLogger.info(`🔌 Conectando ao WebSocket da Evolution API: ${EVOLUTION_API_URL}`);
    socket = (0, socket_io_client_1.io)(EVOLUTION_API_URL, {
        auth: {
            apikey: EVOLUTION_API_KEY
        },
        query: {
            apikey: EVOLUTION_API_KEY
        },
        extraHeaders: {
            apikey: EVOLUTION_API_KEY
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    });
    socket.onAny((event, ...args) => {
        logger_1.evolutionLogger.debug(`[WS Debug] Evento recebido: ${event}`, args);
    });
    socket.on('connect', () => {
        logger_1.evolutionLogger.info('✅ Conectado ao WebSocket da Evolution API');
        if (EVOLUTION_INSTANCE_NAME) {
            logger_1.evolutionLogger.info(`📡 Se inscrevendo na instância: ${EVOLUTION_INSTANCE_NAME}`);
            socket?.emit('instance.subscribe', EVOLUTION_INSTANCE_NAME);
            socket?.emit('subscribe', EVOLUTION_INSTANCE_NAME); // Manter fallback
        }
    });
    socket.on('disconnect', (reason) => {
        logger_1.evolutionLogger.warn(`❌ Desconectado do WebSocket da Evolution API. Motivo: ${reason}`);
    });
    socket.on('connect_error', (error) => {
        logger_1.evolutionLogger.error('Erro na conexão WebSocket da Evolution API:', error.message);
    });
    // Escutar eventos de mensagens
    socket.on('messages.upsert', async (payload) => {
        logger_1.evolutionLogger.info(`📩 Evento 'messages.upsert' capturado:`, JSON.stringify(payload).substring(0, 200));
        // Comentado para depuração: 
        // if (payload.instance && payload.instance !== EVOLUTION_INSTANCE_NAME) {
        //     return;
        // }
        try {
            await (0, message_processor_1.processIncomingMessage)(payload);
        }
        catch (err) {
            logger_1.evolutionLogger.error('Erro ao processar mensagem via WebSocket:', err);
        }
    });
    // Outros eventos úteis
    socket.on('connection.update', (data) => {
        if (data.instance === EVOLUTION_INSTANCE_NAME) {
            logger_1.evolutionLogger.info(`📡 Evolução: Atualização de conexão [${data.data?.state || 'unknown'}]`);
        }
    });
    return socket;
}
function getEvolutionSocket() {
    return socket;
}
//# sourceMappingURL=evolution-ws.js.map