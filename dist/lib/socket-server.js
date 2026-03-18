"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketServer = initSocketServer;
exports.getIO = getIO;
const socket_io_1 = require("socket.io");
const logger_1 = require("./logger");
const redis_1 = require("./redis");
let io = null;
/**
 * Inicializa o Socket.io Server e assina o Redis Pub/Sub
 * para repassar atualizações de chat em tempo real.
 */
function initSocketServer(httpServer) {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: '*', // Em produção, restringir para o domínio do frontend
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
    });
    // ==================== Conexões WebSocket ====================
    io.on('connection', (socket) => {
        logger_1.socketLogger.info(`✅ Cliente conectado: ${socket.id}`);
        // Cliente entra na sala de um chat específico
        socket.on('join-chat', (chatId) => {
            const room = `chat:${chatId}`;
            socket.join(room);
            logger_1.socketLogger.info(`👥 Cliente ${socket.id} entrou na sala ${room}`);
            // Logar quantas pessoas estão na sala (opcional para debug)
            const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
            logger_1.socketLogger.debug(`Sala ${room} agora tem ${clients} cliente(s)`);
        });
        // Cliente sai da sala
        socket.on('leave-chat', (chatId) => {
            socket.leave(`chat:${chatId}`);
            logger_1.socketLogger.debug(`Cliente ${socket.id} saiu da sala chat:${chatId}`);
        });
        socket.on('disconnect', () => {
            logger_1.socketLogger.debug(`❌ Cliente desconectado: ${socket.id}`);
        });
    });
    // ==================== Redis Pub/Sub Subscriber ====================
    const subscriber = (0, redis_1.createRedisConnection)();
    subscriber.on('error', (err) => {
        logger_1.socketLogger.error('Redis subscriber error:', err);
    });
    subscriber.subscribe('haylander-bot-events', 'haylander-chat-updates')
        .then(() => {
        logger_1.socketLogger.info('✅ Assinados canais Redis: haylander-bot-events, haylander-chat-updates');
    })
        .catch((err) => {
        logger_1.socketLogger.error('Falha ao assinar canais Redis:', err);
    });
    subscriber.on('message', (channel, message) => {
        if (channel === 'haylander-bot-events' || channel === 'haylander-chat-updates') {
            try {
                const data = JSON.parse(message);
                const chatId = data.chatId;
                const altChatId = data.altChatId; // JID alternativo (ex: CPF/LID vs Phone)
                if (chatId) {
                    const room = `chat:${chatId}`;
                    const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
                    logger_1.socketLogger.debug(`📢 Emitindo 'new-message' para ${room} (${clients} ouvintes)`);
                    io?.to(room).emit('new-message', data);
                }
                if (altChatId && altChatId !== chatId) {
                    const room = `chat:${altChatId}`;
                    const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
                    logger_1.socketLogger.debug(`📢 Emitindo 'new-message' para ${room} (ALT) (${clients} ouvintes)`);
                    io?.to(room).emit('new-message', data);
                }
                // Enviar update global (para a lista de atendimentos)
                io?.emit('chat-update-global', data);
            }
            catch (err) {
                logger_1.socketLogger.error('Erro ao parsear mensagem Redis:', err);
            }
        }
    });
    logger_1.socketLogger.info('✅ Socket.io Server inicializado');
    return io;
}
function getIO() {
    return io;
}
//# sourceMappingURL=socket-server.js.map