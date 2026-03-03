"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketServer = initSocketServer;
exports.getIO = getIO;
const socket_io_1 = require("socket.io");
const ioredis_1 = __importDefault(require("ioredis"));
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
        console.log(`[Socket.io] ✅ Cliente conectado: ${socket.id}`);
        // Cliente entra na sala de um chat específico
        socket.on('join-chat', (chatId) => {
            socket.join(`chat:${chatId}`);
            console.log(`[Socket.io] Cliente ${socket.id} entrou na sala chat:${chatId}`);
        });
        // Cliente sai da sala
        socket.on('leave-chat', (chatId) => {
            socket.leave(`chat:${chatId}`);
            console.log(`[Socket.io] Cliente ${socket.id} saiu da sala chat:${chatId}`);
        });
        socket.on('disconnect', () => {
            console.log(`[Socket.io] ❌ Cliente desconectado: ${socket.id}`);
        });
    });
    // ==================== Redis Pub/Sub Subscriber ====================
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const subscriber = new ioredis_1.default(redisUrl);
    subscriber.on('error', (err) => {
        console.error('[Socket.io] Redis subscriber error:', err);
    });
    subscriber.subscribe('chat-updates', (err) => {
        if (err) {
            console.error('[Socket.io] Falha ao assinar canal chat-updates:', err);
        }
        else {
            console.log('[Socket.io] ✅ Assinado canal Redis: chat-updates');
        }
    });
    subscriber.on('message', (channel, message) => {
        if (channel === 'chat-updates') {
            try {
                const data = JSON.parse(message);
                const chatId = data.chatId;
                if (chatId) {
                    // Enviar para a sala específica do chat
                    io?.to(`chat:${chatId}`).emit('new-message', data);
                }
                // Enviar update global (para a lista de atendimentos)
                io?.emit('chat-update-global', data);
            }
            catch (err) {
                console.error('[Socket.io] Erro ao parsear mensagem Redis:', err);
            }
        }
    });
    console.log('[Socket.io] ✅ Socket.io Server inicializado');
    return io;
}
function getIO() {
    return io;
}
//# sourceMappingURL=socket-server.js.map