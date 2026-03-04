import { AgentMessage } from '../ai/types';
import OpenAI from 'openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

const log = logger.child('MessageParser');

/**
 * Extrai o conteúdo da mensagem do payload da Evolution API.
 * Retorna um AgentMessage (string ou ContentPart[]) pronto para o agente processar.
 * Retorna null se a mensagem não pôde ser extraída.
 */
export async function parseIncomingMessage(
    msgData: Record<string, unknown> | undefined,
    base64FromBody?: string
): Promise<AgentMessage | null> {
    if (!msgData) return null;

    // 1. Text extraction
    if (typeof msgData.conversation === 'string' && msgData.conversation) {
        return msgData.conversation;
    }
    const extendedText = msgData.extendedTextMessage as Record<string, unknown> | undefined;
    if (extendedText?.text && typeof extendedText.text === 'string') {
        return extendedText.text;
    }

    // 2. Image extraction
    const imageMsg = msgData.imageMessage as Record<string, unknown> | undefined;
    if (imageMsg) {
        const caption = (imageMsg.caption as string) || '';
        const base64 = (base64FromBody || imageMsg.base64) as string | undefined;
        const mimetype = (imageMsg.mimetype as string) || 'image/jpeg';
        if (base64) {
            return [
                { type: 'text', text: caption || 'Analise esta imagem.' },
                { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
            ];
        }
        return caption || null;
    }

    // 3. Document extraction (PDF)
    const docMsg = msgData.documentMessage as Record<string, unknown> | undefined;
    if (docMsg) {
        const caption = (docMsg.caption as string) || '';
        const fileName = (docMsg.fileName as string) || 'documento.pdf';
        const base64 = (base64FromBody || docMsg.base64) as string | undefined;
        const mimetype = (docMsg.mimetype as string) || 'application/pdf';
        if (base64 && mimetype === 'application/pdf') {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const pdfParse = require('pdf-parse');
                const pdfBuffer = Buffer.from(base64, 'base64');
                const pdfData = await pdfParse(pdfBuffer);
                return `${caption} [Conteúdo do PDF ${fileName} extraído com sucesso]:\n\n${pdfData.text}`;
            } catch (err) {
                log.error('Erro ao extrair PDF:', err);
                return `${caption} [Arquivo PDF: ${fileName} - Falha ao extrair texto]`;
            }
        }
        return `${caption} [Arquivo: ${fileName} - Formato não suportado]`;
    }

    // 4. Audio extraction (Whisper)
    const audioMsg = msgData.audioMessage as Record<string, unknown> | undefined;
    if (audioMsg) {
        const base64 = (base64FromBody || audioMsg.base64) as string | undefined;
        if (base64) {
            try {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const tempFilePath = path.join(os.tmpdir(), `${uuidv4()}.ogg`);
                fs.writeFileSync(tempFilePath, Buffer.from(base64, 'base64'));

                try {
                    const transcription = await openai.audio.transcriptions.create({
                        file: fs.createReadStream(tempFilePath),
                        model: 'whisper-1',
                    });
                    return `[ÁUDIO TRANSCRITO DO CLIENTE]: "${transcription.text}"`;
                } finally {
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                }
            } catch (err) {
                log.error('Falha na transcrição de áudio:', err);
                return '[Áudio recebido] (Falha na transcrição)';
            }
        }
        return '[Áudio recebido] (Sem base64)';
    }

    // 5. Sticker / Video / Contact / Location
    if (msgData.stickerMessage) return '[Sticker recebido]';
    const videoMsg = msgData.videoMessage as Record<string, unknown> | undefined;
    if (videoMsg) return `${(videoMsg.caption as string) || ''} [Vídeo recebido]`;
    if (msgData.contactMessage || msgData.contactsArrayMessage) return '[Contato recebido]';
    if (msgData.locationMessage) return '[Localização recebida]';

    return null;
}
