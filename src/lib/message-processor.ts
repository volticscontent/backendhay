import { addToHistory } from './chat-history';
import redis from './redis';
import { notifySocketServer } from './socket';
import { cancelPendingFollowUps } from '../queues/message-queue';
import { bufferAndDebounce } from '../queues/message-debounce';
import { parseIncomingMessage } from './message-parser';
import { webhookLogger } from './logger';
import { saveLidPhoneMapping, resolveLidToPhone } from './lid-map';
import { startHighFrequencyPoke } from './poker';

const log = webhookLogger.child('Processor');

export interface IncomingMessagePayload {
    event: string;
    instance: string;
    data: any;
}

/**
 * Processa mensagens recebidas (via Webhook ou WebSocket)
 */
export async function processIncomingMessage(payload: IncomingMessagePayload) {
    const { data } = payload;
    
    // Extrai a mensagem do payload usando o parser dedicado
    const msgData = data.message;
    const base64FromBody = data.base64;
    const messageId = data.key?.id as string | undefined;
    const message = await parseIncomingMessage(msgData, base64FromBody, messageId);

    // Identify the user phone — priorizar número real, aceitar LID como fallback
    const remoteJid = data.key?.remoteJid as string | undefined;
    const senderPn = data.key?.senderPn as string | undefined;

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
        const resolvedPhone = await resolveLidToPhone(sender);
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
        saveLidPhoneMapping(remoteJid, userPhone, pushName).catch(err =>
            log.error('Erro ao salvar mapeamento LID:', err)
        );
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
    startHighFrequencyPoke();

    // Salvar mapeamento LID → telefone real
    if (remoteJid?.includes('@lid') && userPhone && !sender.includes('@lid')) {
        saveLidPhoneMapping(remoteJid, userPhone, pushName).catch(err =>
            log.error('Erro ao salvar mapeamento LID:', err)
        );
    }

    // Cancelar follow-ups pendentes (cliente respondeu)
    cancelPendingFollowUps(userPhone).catch(err =>
        log.error('Erro ao cancelar follow-ups:', err)
    );

    // Registrar atividade no Redis
    redis.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });

    // Salvar mensagem no histórico
    await addToHistory(userPhone, 'user', message);

    // Notificar Socket Server
    const incomingSocketMsg = { 
        chatId, 
        altChatId: sender, 
        senderPn: sender, 
        userPhone, 
        pushName, 
        ...data 
    };
    notifySocketServer('haylander-bot-events', incomingSocketMsg).catch(err =>
        log.error('Socket notification failed:', err)
    );

    // DEBOUNCE: acumular mensagem e agendar processamento
    const messageText = typeof message === 'string' ? message : JSON.stringify(message);
    await bufferAndDebounce(userPhone, messageText, {
        sender,
        pushName,
        userPhone,
    });

    return { status: 'processed', userPhone };
}
