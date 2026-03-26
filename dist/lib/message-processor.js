"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processIncomingMessage = processIncomingMessage;
const chat_history_1 = require("./chat-history");
const redis_1 = __importDefault(require("./redis"));
const socket_1 = require("./socket");
const message_queue_1 = require("../queues/message-queue");
const message_debounce_1 = require("../queues/message-debounce");
const message_parser_1 = require("./message-parser");
const logger_1 = require("./logger");
const lid_map_1 = require("./lid-map");
const poker_1 = require("./poker");
const log = logger_1.webhookLogger.child('Processor');
/**
 * Processa mensagens recebidas (via Webhook ou WebSocket)
 */
async function processIncomingMessage(payload) {
    const { data } = payload;
    // Extrai a mensagem do payload usando o parser dedicado
    const msgData = data.message;
    const base64FromBody = data.base64;
    const messageId = data.key?.id;
    const message = await (0, message_parser_1.parseIncomingMessage)(msgData, base64FromBody, messageId);
    // Identify the user phone — priorizar número real, aceitar LID como fallback
    const remoteJid = data.key?.remoteJid;
    const senderPn = data.key?.senderPn;
    const candidatos = [
        senderPn,
        data.senderpn,
        data.key?.participant,
        data.participant,
        remoteJid,
    ].filter(Boolean);
    // Pegar o primeiro que NÃO seja grupo, preferindo não-LID
    let sender = candidatos.find(s => !s.includes('@lid') && !s.includes('@g.us'));
    // Se não achou número real, aceitar LID como fallback
    if (!sender) {
        sender = candidatos.find(s => !s.includes('@g.us'));
    }
    // Tentar resolver LID para Phone se necessário
    if (sender?.includes('@lid')) {
        const resolvedPhone = await (0, lid_map_1.resolveLidToPhone)(sender);
        if (resolvedPhone) {
            log.debug(`🧩 LID ${sender} resolvido para número real no Processor: ${resolvedPhone}`);
            sender = `${resolvedPhone}@s.whatsapp.net`;
        }
    }
    // O chatId para o socket DEVE ser o remoteJid (sala que o frontend assina)
    const chatId = remoteJid || sender;
    const fromMe = data.key?.fromMe;
    const pushName = data.pushName;
    const userPhone = sender?.split('@')[0].replace(/\D/g, '');
    // SALVAR MAPEAMENTO: Se recebemos remoteJid como LID e identificamos o telefone real no senderPn
    if (remoteJid?.includes('@lid') && userPhone && sender && !sender.includes('@lid')) {
        (0, lid_map_1.saveLidPhoneMapping)(remoteJid, userPhone, pushName).catch(err => log.error('Erro ao salvar mapeamento LID:', err));
    }
    if (fromMe) {
        log.debug('Ignorando mensagem enviada por mim (fromMe: true)');
        return { status: 'ignored_from_me' };
    }
    if (!message || !sender) {
        log.warn(`Mensagem ou Sender inválido. Message: ${!!message}, Sender: ${sender}`);
        return { status: 'ignored_invalid' };
    }
    const logMsg = typeof message === 'string' ? message : '[Conteúdo Multimodal/Imagem]';
    log.info(`📩 [${payload.instance}] Mensagem de ${userPhone} (${chatId}): ${logMsg}`);
    // Ativar Keep-alive de alta frequência (4s)
    (0, poker_1.startHighFrequencyPoke)();
    // Salvar mapeamento LID → telefone real
    if (remoteJid?.includes('@lid') && userPhone && !sender.includes('@lid')) {
        (0, lid_map_1.saveLidPhoneMapping)(remoteJid, userPhone, pushName).catch(err => log.error('Erro ao salvar mapeamento LID:', err));
    }
    // Cancelar follow-ups pendentes (cliente respondeu)
    (0, message_queue_1.cancelPendingFollowUps)(userPhone).catch(err => log.error('Erro ao cancelar follow-ups:', err));
    // Registrar atividade no Redis
    redis_1.default.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });
    // 1. Deduplicação Atômica por Message ID para evitar processamento duplo (Webhook + WebSocket + Retries)
    if (messageId) {
        const msgKey = `msg_processed:${messageId}`;
        const isNew = await redis_1.default.set(msgKey, '1', 'EX', 3600, 'NX');
        if (!isNew) {
            log.info(`♻️ [DEDUPLICADOR] Mensagem duplicada ignorada (ID: ${messageId})`);
            return { status: 'ignored_duplicate', messageId };
        }
    }
    // Salvar mensagem no histórico
    await (0, chat_history_1.addToHistory)(userPhone, 'user', message);
    // Notificar Socket Server
    const incomingSocketMsg = {
        chatId,
        altChatId: sender,
        senderPn: sender,
        userPhone,
        pushName,
        ...data
    };
    (0, socket_1.notifySocketServer)('haylander-bot-events', incomingSocketMsg).catch(err => log.error('Socket notification failed:', err));
    // DEBOUNCE: acumular mensagem e agendar processamento
    const messageText = typeof message === 'string' ? message : JSON.stringify(message);
    await (0, message_debounce_1.bufferAndDebounce)(userPhone, messageText, {
        sender,
        pushName,
        userPhone,
    });
    return { status: 'processed', userPhone };
}
//# sourceMappingURL=message-processor.js.map