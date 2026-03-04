import OpenAI from 'openai';
import logger from '../lib/logger';

const log = logger.child('Embedding');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
});

export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
            encoding_format: 'float',
        });

        return response.data[0].embedding;
    } catch (error) {
        log.error('Erro ao gerar embedding:', error);
        return [];
    }
}
