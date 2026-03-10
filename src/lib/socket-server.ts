import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import Redis from 'ioredis';
import { socketLogger } from './logger';

let io: SocketIOServer | null = null;

/**
 * Inicializa o Socket.io Server e assina o Redis Pub/Sub
 * para repassar atualizações de chat em tempo real.
 */
export function initSocketServer(httpServer: HTTPServer): SocketIOServer {
    io = new SocketIOServer(httpServer, {
        cors: {
            origin: '*', // Em produção, restringir para o domínio do frontend
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
    });

    // ==================== Conexões WebSocket ====================
    io.on('connection', (socket) => {
        socketLogger.info(`✅ Cliente conectado: ${socket.id}`);

        // Cliente entra na sala de um chat específico
        socket.on('join-chat', (chatId: string) => {
            socket.join(`chat:${chatId}`);
            socketLogger.debug(`Cliente ${socket.id} entrou na sala chat:${chatId}`);
        });

        // Cliente sai da sala
        socket.on('leave-chat', (chatId: string) => {
            socket.leave(`chat:${chatId}`);
            socketLogger.debug(`Cliente ${socket.id} saiu da sala chat:${chatId}`);
        });

        socket.on('disconnect', () => {
            socketLogger.debug(`❌ Cliente desconectado: ${socket.id}`);
        });
    });

    // ==================== Redis Pub/Sub Subscriber ====================
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const subscriber = new Redis(redisUrl);

    subscriber.on('error', (err) => {
        socketLogger.error('Redis subscriber error:', err);
    });

    subscriber.subscribe('haylander-bot-events', (err) => {
        if (err) {
            socketLogger.error('Falha ao assinar canal haylander-bot-events:', err);
        } else {
            socketLogger.info('✅ Assinado canal Redis: haylander-bot-events');
        }
    });

    subscriber.on('message', (channel, message) => {
        if (channel === 'haylander-bot-events') {
            try {
                const data = JSON.parse(message);
                const chatId = data.chatId;

                if (chatId) {
                    // Enviar para a sala específica do chat
                    io?.to(`chat:${chatId}`).emit('new-message', data);
                }

                // Enviar update global (para a lista de atendimentos)
                io?.emit('chat-update-global', data);
            } catch (err) {
                socketLogger.error('Erro ao parsear mensagem Redis:', err);
            }
        }
    });

    socketLogger.info('✅ Socket.io Server inicializado');
    return io;
}

export function getIO(): SocketIOServer | null {
    return io;
}
