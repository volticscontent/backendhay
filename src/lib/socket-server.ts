import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import Redis from 'ioredis';
import { socketLogger } from './logger';
import { createRedisConnection } from './redis';

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
            const room = `chat:${chatId}`;
            socket.join(room);
            socketLogger.info(`👥 Cliente ${socket.id} entrou na sala ${room}`);
            
            // Logar quantas pessoas estão na sala (opcional para debug)
            const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
            socketLogger.debug(`Sala ${room} agora tem ${clients} cliente(s)`);
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
    const subscriber = createRedisConnection();

    subscriber.on('error', (err: Error) => {
        socketLogger.error('Redis subscriber error:', err);
    });

    subscriber.subscribe('haylander-bot-events', 'haylander-chat-updates')
        .then(() => {
            socketLogger.info('✅ Assinados canais Redis: haylander-bot-events, haylander-chat-updates');
        })
        .catch((err) => {
            socketLogger.error('Falha ao assinar canais Redis:', err);
        });

    subscriber.on('message', (channel: string, message: string) => {
        if (channel === 'haylander-bot-events' || channel === 'haylander-chat-updates') {
            try {
                const data = JSON.parse(message);
                const chatId = data.chatId;
                const altChatId = data.altChatId; // JID alternativo (ex: CPF/LID vs Phone)

                if (chatId) {
                    const room = `chat:${chatId}`;
                    const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
                    socketLogger.debug(`📢 Emitindo 'new-message' para ${room} (${clients} ouvintes)`);
                    io?.to(room).emit('new-message', data);
                }

                if (altChatId && altChatId !== chatId) {
                    const room = `chat:${altChatId}`;
                    const clients = io?.sockets.adapter.rooms.get(room)?.size || 0;
                    socketLogger.debug(`📢 Emitindo 'new-message' para ${room} (ALT) (${clients} ouvintes)`);
                    io?.to(room).emit('new-message', data);
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
