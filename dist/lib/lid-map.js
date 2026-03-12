"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLidPhoneMapping = saveLidPhoneMapping;
exports.resolveLidToPhone = resolveLidToPhone;
exports.warmLidCache = warmLidCache;
const db_1 = __importDefault(require("./db"));
const redis_1 = __importDefault(require("./redis"));
const logger_1 = require("./logger");
const log = logger_1.webhookLogger.child?.('LidMap') || logger_1.webhookLogger;
/**
 * Salva o mapeamento LID → telefone real no Redis + PostgreSQL.
 * No PostgreSQL, faz UPDATE na tabela Contact da Evolution API
 * para associar o pushName ao contato LID.
 * O senderPn já é salvo automaticamente pela Evolution API na key da Message.
 */
async function saveLidPhoneMapping(lid, phone, pushName) {
    // 1. Salvar no Redis (cache rápido, TTL 30 dias)
    const lidKey = `lid_map:${lid}`;
    const phoneKey = `phone_lid:${phone}`;
    redis_1.default.set(lidKey, phone, 'EX', 2592000).catch(() => { });
    redis_1.default.set(phoneKey, lid, 'EX', 2592000).catch(() => { });
    // 2. No PostgreSQL, atualizar o Contact da Evolution para ter pushName correto
    // (o senderPn já fica registrado na key da Message pela Evolution API)
    if (pushName) {
        try {
            await db_1.default.query(`UPDATE "Contact" SET "pushName" = $1, "updatedAt" = NOW() WHERE "remoteJid" = $2 AND "pushName" IS NULL`, [pushName, lid]);
        }
        catch (err) {
            log.warn?.('Falha ao atualizar Contact:', err);
        }
    }
}
/**
 * Resolve um LID para telefone real.
 * Tenta Redis primeiro, depois consulta a tabela Message da Evolution API.
 */
async function resolveLidToPhone(lid) {
    // 1. Tentar Redis (rápido)
    try {
        const cached = await redis_1.default.get(`lid_map:${lid}`);
        if (cached)
            return cached;
    }
    catch { /* ignore */ }
    // 2. Fallback: buscar senderPn na tabela Message da Evolution API
    try {
        const { rows } = await db_1.default.query(`SELECT key->>'senderPn' as sender_pn 
             FROM "Message" 
             WHERE key->>'remoteJid' = $1 
               AND key->>'senderPn' IS NOT NULL 
             LIMIT 1`, [lid]);
        if (rows[0]?.sender_pn) {
            const phone = rows[0].sender_pn.replace('@s.whatsapp.net', '');
            // Re-popular o cache Redis
            redis_1.default.set(`lid_map:${lid}`, phone, 'EX', 2592000).catch(() => { });
            redis_1.default.set(`phone_lid:${phone}`, lid, 'EX', 2592000).catch(() => { });
            return phone;
        }
    }
    catch { /* ignore */ }
    return null;
}
/**
 * Pré-carrega mapeamentos LID→telefone no Redis a partir das tabelas da Evolution API.
 * Consulta Messages que têm senderPn na key para construir o cache.
 */
async function warmLidCache() {
    try {
        const { rows } = await db_1.default.query(`
            SELECT DISTINCT 
                key->>'remoteJid' as lid, 
                key->>'senderPn' as sender_pn
            FROM "Message"
            WHERE key->>'remoteJid' LIKE '%@lid'
              AND key->>'senderPn' IS NOT NULL
        `);
        if (rows.length === 0) {
            log.info?.('🗺️ Nenhum mapeamento LID encontrado nas Messages');
            return;
        }
        const pipeline = redis_1.default.pipeline();
        for (const row of rows) {
            const phone = row.sender_pn.replace('@s.whatsapp.net', '');
            pipeline.set(`lid_map:${row.lid}`, phone, 'EX', 2592000);
            pipeline.set(`phone_lid:${phone}`, row.lid, 'EX', 2592000);
        }
        await pipeline.exec();
        log.info?.(`🗺️ Cache LID aquecido: ${rows.length} mapeamentos carregados da tabela Message`);
    }
    catch (err) {
        log.warn?.('Falha ao aquecer cache LID:', err);
    }
}
//# sourceMappingURL=lid-map.js.map