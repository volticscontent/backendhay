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
/**
 * Extrai o conteúdo da mensagem do payload da Evolution API.
 * Retorna um AgentMessage (string ou ContentPart[]) pronto para o agente processar.
 * Retorna null se a mensagem não pôde ser extraída.
 */
async function parseIncomingMessage(msgData, base64FromBody) {
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
        const base64 = (base64FromBody || imageMsg.base64);
        const mimetype = imageMsg.mimetype || 'image/jpeg';
        if (base64) {
            return [
                { type: 'text', text: caption || 'Analise esta imagem.' },
                { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
            ];
        }
        return caption || null;
    }
    // 3. Document extraction (PDF)
    const docMsg = msgData.documentMessage;
    if (docMsg) {
        const caption = docMsg.caption || '';
        const fileName = docMsg.fileName || 'documento.pdf';
        const base64 = (base64FromBody || docMsg.base64);
        const mimetype = docMsg.mimetype || 'application/pdf';
        if (base64 && mimetype === 'application/pdf') {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const pdfParse = require('pdf-parse');
                const pdfBuffer = Buffer.from(base64, 'base64');
                const pdfData = await pdfParse(pdfBuffer);
                return `${caption} [Conteúdo do PDF ${fileName} extraído com sucesso]:\n\n${pdfData.text}`;
            }
            catch (err) {
                console.error('[MessageParser] Erro ao extrair PDF:', err);
                return `${caption} [Arquivo PDF: ${fileName} - Falha ao extrair texto]`;
            }
        }
        return `${caption} [Arquivo: ${fileName} - Formato não suportado]`;
    }
    // 4. Audio extraction (Whisper)
    const audioMsg = msgData.audioMessage;
    if (audioMsg) {
        const base64 = (base64FromBody || audioMsg.base64);
        if (base64) {
            try {
                const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
                const tempFilePath = node_path_1.default.join(node_os_1.default.tmpdir(), `${(0, uuid_1.v4)()}.ogg`);
                node_fs_1.default.writeFileSync(tempFilePath, Buffer.from(base64, 'base64'));
                try {
                    const transcription = await openai.audio.transcriptions.create({
                        file: node_fs_1.default.createReadStream(tempFilePath),
                        model: 'whisper-1',
                    });
                    return `[ÁUDIO TRANSCRITO DO CLIENTE]: "${transcription.text}"`;
                }
                finally {
                    if (node_fs_1.default.existsSync(tempFilePath)) {
                        node_fs_1.default.unlinkSync(tempFilePath);
                    }
                }
            }
            catch (err) {
                console.error('[MessageParser] Falha na transcrição de áudio:', err);
                return '[Áudio recebido] (Falha na transcrição)';
            }
        }
        return '[Áudio recebido] (Sem base64)';
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