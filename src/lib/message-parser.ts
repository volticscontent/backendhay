import { AgentMessage } from '../ai/types';
import OpenAI from 'openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import { evolutionGetBase64FromMedia } from './evolution';

const log = logger.child('MessageParser');

/**
 * Tenta obter o base64 da mídia:
 * 1. Primeiro tenta do body (inline)
 * 2. Se não tiver, tenta baixar via Evolution API
 */
async function resolveBase64(
    inlineBase64: string | undefined,
    messageId: string | undefined,
    mediaType: string,
    convertToMp4: boolean = false,
): Promise<string | undefined> {
    if (inlineBase64) {
        log.debug(`${mediaType}: base64 inline disponível`);
        return inlineBase64;
    }

    if (messageId) {
        log.info(`${mediaType}: base64 não inline, baixando via Evolution API (msgId: ${messageId})...`);
        const timer = log.timer(`Download ${mediaType}`);
        const result = await evolutionGetBase64FromMedia(messageId, convertToMp4);
        if (result?.base64) {
            timer.end();
            return result.base64;
        }
        timer.end('FALHOU');
        log.warn(`${mediaType}: falha ao baixar mídia via Evolution API`);
    } else {
        log.warn(`${mediaType}: sem base64 e sem messageId — impossível processar`);
    }

    return undefined;
}

/**
 * Extrai o conteúdo da mensagem do payload da Evolution API.
 * Retorna um AgentMessage (string ou ContentPart[]) pronto para o agente processar.
 * Retorna null se a mensagem não pôde ser extraída.
 */
export async function parseIncomingMessage(
    msgData: Record<string, unknown> | undefined,
    base64FromBody?: string,
    messageId?: string,
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
        const rawBase64 = (base64FromBody || imageMsg.base64) as string | undefined;
        const mimetype = (imageMsg.mimetype as string) || 'image/jpeg';

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
    // documentWithCaptionMessage é o formato usado por clientes Android recentes (WhatsApp v2.23+)
    const docMsg = (msgData.documentMessage ?? msgData.documentWithCaptionMessage) as Record<string, unknown> | undefined;
    if (docMsg) {
        const caption = (docMsg.caption as string) || '';
        const fileName = (docMsg.fileName as string) || 'documento.pdf';
        const rawBase64 = (base64FromBody || docMsg.base64) as string | undefined;
        const mimetype = (docMsg.mimetype as string) || 'application/pdf';

        const base64 = await resolveBase64(rawBase64, messageId, 'PDF');

        if (base64 && mimetype === 'application/pdf') {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const pdfParse = require('pdf-parse');
                const pdfBuffer = Buffer.from(base64, 'base64');
                const pdfData = await pdfParse(pdfBuffer);
                log.info(`📄 PDF extraído: ${fileName} (${pdfData.text.length} chars)`);
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
        const rawBase64 = (base64FromBody || audioMsg.base64) as string | undefined;

        const base64 = await resolveBase64(rawBase64, messageId, 'Áudio');

        if (base64) {
            try {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const tempFilePath = path.join(os.tmpdir(), `${uuidv4()}.ogg`);
                fs.writeFileSync(tempFilePath, Buffer.from(base64, 'base64'));

                try {
                    const timer = log.timer('Whisper transcrição');
                    const transcription = await openai.audio.transcriptions.create({
                        file: fs.createReadStream(tempFilePath),
                        model: 'whisper-1',
                    });
                    timer.end();
                    log.info(`🎙️ Áudio transcrito: "${transcription.text.substring(0, 80)}${transcription.text.length > 80 ? '...' : ''}"`);
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
        return '[Áudio recebido] (Não foi possível baixar o áudio)';
    }

    // 5. Sticker / Video / Contact / Location
    if (msgData.stickerMessage) return '[Sticker recebido]';
    const videoMsg = msgData.videoMessage as Record<string, unknown> | undefined;
    if (videoMsg) return `${(videoMsg.caption as string) || ''} [Vídeo recebido]`;
    if (msgData.contactMessage || msgData.contactsArrayMessage) return '[Contato recebido]';
    if (msgData.locationMessage) return '[Localização recebida]';

    return null;
}
