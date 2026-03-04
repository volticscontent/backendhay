import pool from '../lib/db';
import { listFilesFromR2 } from '../lib/r2';
import redis from '../lib/redis';
import logger from '../lib/logger';

const log = logger.child('KnowledgeBase');

/**
 * Busca e formata a lista de serviços do banco de dados para injetar no contexto da IA.
 */
export async function getServicesContext(): Promise<string> {
    try {
        const client = await pool.connect();
        try {
            const res = await client.query(`SELECT * FROM services ORDER BY name ASC`);

            if (res.rowCount === 0) return 'Nenhum serviço cadastrado no momento.';

            const servicesList = res.rows.map(s => {
                const nome = s.name || s.nome || 'Sem Nome';
                const valor = s.value || s.valor || 0;
                const descricao = s.description || s.descricao || 'Sem descrição';
                return `- **${nome}**: R$ ${Number(valor).toFixed(2)}\n  Descrição: ${descricao}`;
            }).join('\n');

            return `## SERVIÇOS E PRODUTOS DISPONÍVEIS:\n${servicesList}`;
        } finally {
            client.release();
        }
    } catch (error) {
        log.error('Erro ao buscar serviços:', error);
        return 'Erro ao carregar lista de serviços.';
    }
}

/**
 * Busca e formata a lista de arquivos/assets do R2 para o contexto da IA.
 */
export async function getAssetsContext(): Promise<string> {
    try {
        const files = await listFilesFromR2();

        if (files.length === 0) return 'Nenhum arquivo de mídia ou asset disponível no momento.';

        const validExtensions = ['.pdf', '.mp4', '.jpg', '.jpeg', '.png', '.docx', '.pptx'];
        const relevantFiles = files.filter(f =>
            validExtensions.some(ext => f.key.toLowerCase().endsWith(ext)) &&
            !f.key.toLowerCase().includes('private') &&
            !f.key.toLowerCase().includes('interno')
        );

        const assetsList = relevantFiles.map(f => {
            const readableName = f.key.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '') || f.key;
            return `- **${readableName}** (${f.key}):\n  Link: ${f.url}`;
        }).join('\n');

        return `## ASSETS E MATERIAIS DE APOIO (R2):\nEstes são os arquivos que você pode enviar aos clientes. Use a ferramenta 'enviar_midia' com a chave (key) ou URL.\n${assetsList}`;
    } catch (error) {
        log.error('Erro ao buscar assets:', error);
        return 'Erro ao carregar lista de assets.';
    }
}

/**
 * Agrega todo o conhecimento dinâmico (Serviços + Assets)
 */
export async function getDynamicContext(): Promise<string> {
    const CACHE_KEY = 'static:ai_dynamic_context';

    try {
        // 1. Tenta buscar do cache primeiro
        const cachedContext = await redis.get(CACHE_KEY);
        if (cachedContext) {
            return cachedContext;
        }
    } catch (err) {
        log.warn('Erro ao ler do cache Redis:', err);
    }

    // 2. Se não tem no cache, busca na fonte original (DB + R2)
    const [services, assets] = await Promise.all([
        getServicesContext(),
        getAssetsContext(),
    ]);

    const result = `\n\n${services}\n\n${assets}`;

    try {
        // 3. Salva no cache por 10 minutos (600 segundos)
        await redis.setex(CACHE_KEY, 600, result);
    } catch (err) {
        log.warn('Erro ao salvar no cache Redis:', err);
    }

    return result;
}
