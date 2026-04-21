"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALIDITY_DAYS = void 0;
exports.maybeSavePdfFromBotResult = maybeSavePdfFromBotResult;
exports.saveConsultation = saveConsultation;
exports.saveDocumento = saveDocumento;
exports.listDocumentos = listDocumentos;
exports.softDeleteDocumento = softDeleteDocumento;
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
const r2_1 = require("./r2");
exports.VALIDITY_DAYS = {
    SIT_FISCAL_RELATORIO: 90,
    CND: 180,
    PGMEI_EXTRATO: 30,
    PGMEI_BOLETO: 30,
};
const PDF_SERVICES = new Set(['SIT_FISCAL_RELATORIO', 'CND', 'PGMEI_EXTRATO', 'PGMEI_BOLETO']);
/**
 * Tenta extrair um PDF base64 de qualquer resposta do Serpro.
 * Os PDFs podem estar em `dados.pdf`, `pdf`, ou dentro de `dados` stringificado.
 */
function extractPdfBase64(result) {
    if (!result || typeof result !== 'object')
        return null;
    const r = result;
    const direct = r['pdf'];
    if (typeof direct === 'string' && direct.length > 100)
        return direct;
    const dados = r['dados'];
    if (typeof dados === 'string') {
        try {
            const parsed = JSON.parse(dados);
            const p = parsed['pdf'];
            if (typeof p === 'string' && p.length > 100)
                return p;
        }
        catch { /* ignore */ }
    }
    else if (dados && typeof dados === 'object') {
        const p = dados['pdf'];
        if (typeof p === 'string' && p.length > 100)
            return p;
    }
    return null;
}
/**
 * Se a resposta de um serviço contiver PDF base64, faz upload para R2
 * e persiste o registro em serpro_documentos. Silencioso em caso de falha.
 */
async function maybeSavePdfFromBotResult(cnpj, service, result, protocolo) {
    if (!PDF_SERVICES.has(service))
        return;
    const pdfBase64 = extractPdfBase64(result);
    if (!pdfBase64)
        return;
    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const dateStr = new Date().toISOString().split('T')[0];
        const safeProto = (protocolo ?? `bot-${Date.now()}`).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 50);
        const r2Key = `serpro-docs/${service}/${cleanCnpj}/${dateStr}-${safeProto}.pdf`;
        const buffer = Buffer.from(pdfBase64, 'base64');
        const r2Url = await (0, r2_1.uploadFileToR2)(buffer, r2Key, 'application/pdf');
        await saveDocumento({
            cnpj: cleanCnpj,
            tipo_servico: service,
            protocolo: protocolo ?? null,
            r2_key: r2Key,
            r2_url: r2Url,
            tamanho_bytes: buffer.length,
            gerado_por: 'bot',
        });
        logger_1.dbLogger.info(`[maybeSavePdf] PDF ${service} salvo para CNPJ ${cleanCnpj} → ${r2Key}`);
    }
    catch (err) {
        logger_1.dbLogger.error('[maybeSavePdf] Falha ao salvar PDF do bot:', err);
    }
}
async function saveConsultation(cnpj, service, result, status, source = 'bot') {
    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const q = `
      INSERT INTO consultas_serpro (cnpj, tipo_servico, resultado, status, source, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `;
        const res = await db_1.default.query(q, [cleanCnpj, service, result, status, source]);
        logger_1.dbLogger.debug(`Consulta Serpro salva. ID: ${res.rows[0].id}`);
    }
    catch (error) {
        logger_1.dbLogger.error('Erro ao salvar consulta Serpro:', error);
    }
}
async function saveDocumento(input) {
    const cleanCnpj = input.cnpj.replace(/\D/g, '');
    // Calcular validade se não informada pelo chamador
    let validoAte = input.valido_ate ?? null;
    if (!validoAte) {
        const days = exports.VALIDITY_DAYS[input.tipo_servico] ?? null;
        if (days)
            validoAte = new Date(Date.now() + days * 86_400_000).toISOString();
    }
    const res = await db_1.default.query(`INSERT INTO serpro_documentos
           (cnpj, tipo_servico, protocolo, r2_key, r2_url, tamanho_bytes, valido_ate, gerado_por, lead_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, valido_ate`, [
        cleanCnpj,
        input.tipo_servico,
        input.protocolo ?? null,
        input.r2_key,
        input.r2_url,
        input.tamanho_bytes ?? null,
        validoAte,
        input.gerado_por ?? 'admin',
        input.lead_id ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
    ]);
    return { id: res.rows[0].id, valido_ate: res.rows[0].valido_ate };
}
async function listDocumentos(opts = {}) {
    const conditions = ['deletado_em IS NULL'];
    const params = [];
    if (opts.cnpj) {
        params.push(opts.cnpj.replace(/\D/g, ''));
        conditions.push(`cnpj = $${params.length}`);
    }
    if (opts.tipo_servico) {
        params.push(opts.tipo_servico);
        conditions.push(`tipo_servico = $${params.length}`);
    }
    if (opts.gerado_por) {
        params.push(opts.gerado_por);
        conditions.push(`gerado_por = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    params.push(limit, offset);
    const res = await db_1.default.query(`SELECT
           d.id, d.cnpj, d.tipo_servico, d.protocolo, d.r2_url, d.tamanho_bytes,
           d.valido_ate, d.gerado_por, d.lead_id, d.metadata, d.created_at,
           l.nome_completo AS lead_nome
         FROM serpro_documentos d
         LEFT JOIN leads l ON LTRIM(REGEXP_REPLACE(l.cnpj,'[^0-9]','','g'),'0') = LTRIM(REGEXP_REPLACE(d.cnpj,'[^0-9]','','g'),'0')
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return res.rows;
}
async function softDeleteDocumento(id) {
    const res = await db_1.default.query(`UPDATE serpro_documentos SET deletado_em = NOW() WHERE id = $1 AND deletado_em IS NULL RETURNING id`, [id]);
    return (res.rowCount ?? 0) > 0;
}
//# sourceMappingURL=serpro-db.js.map