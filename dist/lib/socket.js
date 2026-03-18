"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifySocketServer = notifySocketServer;
const redis_1 = __importDefault(require("./redis"));
const logger_1 = require("./logger");
const SOCKET_SERVER_URL = process.env.SOCKET_SERVER_URL;
/**
 * Notifica o Socket Server via Redis Pub/Sub ou HTTP fallback
 */
async function notifySocketServer(channel, data) {
    try {
        // Pub/Sub (preferido — baixa latência)
        const payload = JSON.stringify(data);
        logger_1.socketLogger.debug(`🚀 Publicando no Redis [${channel}]: ${payload.substring(0, 100)}...`);
        await redis_1.default.publish(channel, payload);
    }
    catch (pubsubError) {
        logger_1.socketLogger.warn('Redis Pub/Sub falhou, tentando HTTP fallback:', pubsubError);
        // HTTP Fallback
        if (SOCKET_SERVER_URL) {
            try {
                await fetch(`${SOCKET_SERVER_URL}/notify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, data }),
                });
            }
            catch (httpError) {
                logger_1.socketLogger.error('HTTP fallback também falhou:', httpError);
            }
        }
    }
}
//# sourceMappingURL=socket.js.map