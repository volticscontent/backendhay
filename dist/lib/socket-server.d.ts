import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
/**
 * Inicializa o Socket.io Server e assina o Redis Pub/Sub
 * para repassar atualizações de chat em tempo real.
 */
export declare function initSocketServer(httpServer: HTTPServer): SocketIOServer;
export declare function getIO(): SocketIOServer | null;
//# sourceMappingURL=socket-server.d.ts.map