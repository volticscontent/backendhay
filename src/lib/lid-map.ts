import pool, { evolutionPool } from './db';
import redis from './redis';
import { webhookLogger } from './logger';

const log = webhookLogger.child?.('LidMap') || webhookLogger;

/**
 * Salva o mapeamento LID → telefone real no Redis + PostgreSQL.
 * No PostgreSQL, faz UPDATE na tabela Contact da Evolution API
 * para associar o pushName ao contato LID.
 * O senderPn já é salvo automaticamente pela Evolution API na key da Message.
 */
export async function saveLidPhoneMapping(
    lid: string,
    phone: string,
    pushName?: string | null
): Promise<void> {
    // 1. Salvar no Redis (cache rápido, TTL 30 dias)
    const lidKey = `lid_map:${lid}`;
    const phoneKey = `phone_lid:${phone}`;
    redis.set(lidKey, phone, 'EX', 2592000).catch(() => { });
    redis.set(phoneKey, lid, 'EX', 2592000).catch(() => { });

    // 2. No PostgreSQL, atualizar o Contact da Evolution para ter pushName correto
    // (o senderPn já fica registrado na key da Message pela Evolution API)
    if (pushName) {
        try {
            await pool.query(
                `UPDATE "Contact" SET "pushName" = $1, "updatedAt" = NOW() WHERE "remoteJid" = $2 AND "pushName" IS NULL`,
                [pushName, lid]
            );
        } catch (err) {
            log.warn?.('Falha ao atualizar Contact:', err);
        }
    }
}

/**
 * Resolve um LID para telefone real.
 * Tenta Redis primeiro, depois consulta a tabela Message da Evolution API.
 */
export async function resolveLidToPhone(lid: string): Promise<string | null> {
    // 1. Tentar Redis (rápido)
    try {
        const cached = await redis.get(`lid_map:${lid}`);
        if (cached) return cached;
    } catch { /* ignore */ }

    // 2. Fallback: buscar senderPn na tabela Message da Evolution API
    try {
        const { rows } = await evolutionPool.query(
            `SELECT key->>'remoteJidAlt' as phone_jid
             FROM "Message"
             WHERE key->>'remoteJid' = $1
               AND key->>'remoteJidAlt' IS NOT NULL
             LIMIT 1`,
            [lid]
        );
        if (rows[0]?.phone_jid) {
            const phone = rows[0].phone_jid.replace('@s.whatsapp.net', '');
            redis.set(`lid_map:${lid}`, phone, 'EX', 2592000).catch(() => { });
            redis.set(`phone_lid:${phone}`, lid, 'EX', 2592000).catch(() => { });
            return phone;
        }
    } catch { /* ignore */ }

    return null;
}

/**
 * Pré-carrega mapeamentos LID→telefone no Redis a partir das tabelas da Evolution API.
 * Consulta Messages que têm senderPn na key para construir o cache.
 */
export async function warmLidCache(): Promise<void> {
    try {
        const { rows } = await evolutionPool.query(`
            SELECT DISTINCT
                key->>'remoteJid' as lid,
                key->>'remoteJidAlt' as phone_jid
            FROM "Message"
            WHERE key->>'remoteJid' LIKE '%@lid'
              AND key->>'remoteJidAlt' IS NOT NULL
        `);

        if (rows.length === 0) {
            log.info?.('🗺️ Nenhum mapeamento LID encontrado nas Messages');
            return;
        }

        const pipeline = redis.pipeline();
        for (const row of rows) {
            const phone = row.phone_jid.replace('@s.whatsapp.net', '');
            pipeline.set(`lid_map:${row.lid}`, phone, 'EX', 2592000);
            pipeline.set(`phone_lid:${phone}`, row.lid, 'EX', 2592000);
        }
        await pipeline.exec();
        log.info?.(`🗺️ Cache LID aquecido: ${rows.length} mapeamentos carregados da tabela Message`);
    } catch (err) {
        log.warn?.('Falha ao aquecer cache LID:', err);
    }
}
