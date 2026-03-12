"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIncomingMessage = parseIncomingMessage;
const openai_1 = __importDefault(require("openai"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("./logger"));
const evolution_1 = require("./evolution");
const log = logger_1.default.child('MessageParser');
/**
 * Tenta obter o base64 da mídia:
 * 1. Primeiro tenta do body (inline)
 * 2. Se não tiver, tenta baixar via Evolution API
 */
async function resolveBase64(inlineBase64, messageId, mediaType, convertToMp4 = false) {
    if (inlineBase64) {
        log.debug(`${mediaType}: base64 inline disponível`);
        return inlineBase64;
    }
    if (messageId) {
        log.info(`${mediaType}: base64 não inline, baixando via Evolution API (msgId: ${messageId})...`);
        const timer = log.timer(`Download ${mediaType}`);
        const result = await (0, evolution_1.evolutionGetBase64FromMedia)(messageId, convertToMp4);
        if (result?.base64) {
            timer.end();
            return result.base64;
        }
        timer.end('FALHOU');
        log.warn(`${mediaType}: falha ao baixar mídia via Evolution API`);
    }
    else {
        log.warn(`${mediaType}: sem base64 e sem messageId — impossível processar`);
    }
    return undefined;
}
/**
 * Extrai o conteúdo da mensagem do payload da Evolution API.
 * Retorna um AgentMessage (string ou ContentPart[]) pronto para o agente processar.
 * Retorna null se a mensagem não pôde ser extraída.
 */
async function parseIncomingMessage(msgData, base64FromBody, messageId) {
    if (!msgData)
        return null;
    // 1. Text extraction
    if (typeof msgData.conversation === 'string' && msgData.conversation) {
        return msgData.conversation;
    }
    const extendedText = msgData.extendedTextMessage;
    if (extendedText?.text && typeof extendedText.text === 'string') {
        return extendedText.text;
    }
    // 2. Image extraction
    const imageMsg = msgData.imageMessage;
    if (imageMsg) {
        const caption = imageMsg.caption || '';
        const rawBase64 = (base64FromBody || imageMsg.base64);
        const mimetype = imageMsg.mimetype || 'image/jpeg';
        const base64 = await resolveBase64(rawBase64, messageId, 'Imagem');
        if (base64) {
            log.info(`📷 Imagem processada (${(base64.length / 1024).toFixed(0)}KB)`);
            return [
                { type: 'text', text: caption || 'Analise esta imagem enviada pelo cliente.' },
                { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
            ];
        }
        return caption || '[Imagem recebida, mas não foi possível processar]';
    }
    // 3. Document extraction (PDF)
    const docMsg = msgData.documentMessage;
    if (docMsg) {
        const caption = docMsg.caption || '';
        const fileName = docMsg.fileName || 'documento.pdf';
        const rawBase64 = (base64FromBody || docMsg.base64);
        const mimetype = docMsg.mimetype || 'application/pdf';
        const base64 = await resolveBase64(rawBase64, messageId, 'PDF');
        if (base64 && mimetype === 'application/pdf') {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const pdfParse = require('pdf-parse');
                const pdfBuffer = Buffer.from(base64, 'base64');
                const pdfData = await pdfParse(pdfBuffer);
                log.info(`📄 PDF extraído: ${fileName} (${pdfData.text.length} chars)`);
                return `${caption} [Conteúdo do PDF ${fileName} extraído com sucesso]:\n\n${pdfData.text}`;
            }
            catch (err) {
                log.error('Erro ao extrair PDF:', err);
                return `${caption} [Arquivo PDF: ${fileName} - Falha ao extrair texto]`;
            }
        }
        return `${caption} [Arquivo: ${fileName} - Formato não suportado]`;
    }
    // 4. Audio extraction (Whisper)
    const audioMsg = msgData.audioMessage;
    if (audioMsg) {
        const rawBase64 = (base64FromBody || audioMsg.base64);
        const base64 = await resolveBase64(rawBase64, messageId, 'Áudio');
        if (base64) {
            try {
                const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
                const tempFilePath = node_path_1.default.join(node_os_1.default.tmpdir(), `${(0, uuid_1.v4)()}.ogg`);
                node_fs_1.default.writeFileSync(tempFilePath, Buffer.from(base64, 'base64'));
                try {
                    const timer = log.timer('Whisper transcrição');
                    const transcription = await openai.audio.transcriptions.create({
                        file: node_fs_1.default.createReadStream(tempFilePath),
                        model: 'whisper-1',
                    });
                    timer.end();
                    log.info(`🎙️ Áudio transcrito: "${transcription.text.substring(0, 80)}${transcription.text.length > 80 ? '...' : ''}"`);
                    return `[ÁUDIO TRANSCRITO DO CLIENTE]: "${transcription.text}"`;
                }
                finally {
                    if (node_fs_1.default.existsSync(tempFilePath)) {
                        node_fs_1.default.unlinkSync(tempFilePath);
                    }
                }
            }
            catch (err) {
                log.error('Falha na transcrição de áudio:', err);
                return '[Áudio recebido] (Falha na transcrição)';
            }
        }
        return '[Áudio recebido] (Não foi possível baixar o áudio)';
    }
    // 5. Sticker / Video / Contact / Location
    if (msgData.stickerMessage)
        return '[Sticker recebido]';
    const videoMsg = msgData.videoMessage;
    if (videoMsg)
        return `${videoMsg.caption || ''} [Vídeo recebido]`;
    if (msgData.contactMessage || msgData.contactsArrayMessage)
        return '[Contato recebido]';
    if (msgData.locationMessage)
        return '[Localização recebida]';
    return null;
}
//# sourceMappingURL=message-parser.js.map