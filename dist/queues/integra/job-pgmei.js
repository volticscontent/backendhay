"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pgmeiQueue = void 0;
exports.startPgmeiWorker = startPgmeiWorker;
exports.enqueueRoboPgmei = enqueueRoboPgmei;
const bullmq_1 = require("bullmq");
const redis_1 = require("../../lib/redis");
const db_1 = require("../../lib/db");
const serpro_1 = require("../../lib/serpro");
const r2_1 = require("../../lib/r2");
const logger_1 = require("../../lib/logger");
const QUEUE_NAME = 'integra-pgmei';
const CONCURRENCY = 3;
function parseMaybeJson(value) {
    if (value && typeof value === 'object' && !Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch {
            return null;
        }
    }
    return null;
}
function extractPdfBase64(result) {
    if (!result || typeof result !== 'object')
        return null;
    const root = result;
    if (typeof root.pdf === 'string' && root.pdf.length > 100)
        return root.pdf;
    const dados = parseMaybeJson(root.dados);
    if (dados && typeof dados.pdf === 'string' && dados.pdf.length > 100)
        return dados.pdf;
    return null;
}
function parseValor(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw))
        return raw;
    if (typeof raw !== 'string')
        return null;
    const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}
function parseDateToIso(raw) {
    if (typeof raw !== 'string' || !raw.trim())
        return null;
    const value = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(value))
        return value.slice(0, 10);
    const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br)
        return `${br[3]}-${br[2]}-${br[1]}`;
    return null;
}
function resolveCompetencia(item) {
    const fromPeriodo = item.periodoApuracao ?? item.competencia ?? item.referencia;
    if (typeof fromPeriodo === 'string') {
        const digits = fromPeriodo.replace(/\D/g, '');
        if (digits.length >= 6)
            return digits.slice(0, 6);
    }
    const ano = typeof item.anoCalendario === 'string' ? item.anoCalendario : String(new Date().getFullYear());
    const mesRaw = typeof item.mesApuracao === 'string' ? item.mesApuracao : String(new Date().getMonth() + 1);
    const mes = mesRaw.replace(/\D/g, '').padStart(2, '0').slice(0, 2) || String(new Date().getMonth() + 1).padStart(2, '0');
    return `${ano}${mes}`;
}
function extractGuias(result) {
    const root = (result && typeof result === 'object') ? result : {};
    const dados = parseMaybeJson(root.dados) ?? root;
    const buckets = ['guias', 'das', 'debitos', 'parcelas', 'itens', 'lista'];
    for (const key of buckets) {
        const maybe = dados[key];
        if (Array.isArray(maybe)) {
            const rows = maybe.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x));
            if (rows.length > 0)
                return rows;
        }
    }
    return [dados];
}
exports.pgmeiQueue = new bullmq_1.Queue(QUEUE_NAME, {
    connection: (0, redis_1.createRedisConnection)(),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
    },
});
async function processEmpresa(execucaoId, empresaId, cnpj) {
    try {
        const result = await (0, serpro_1.consultarServico)('PGMEI', cnpj);
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const pdfBase64 = extractPdfBase64(result);
        let pdfR2Key = null;
        if (pdfBase64) {
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10);
            pdfR2Key = `integra/guias/pgmei/${cleanCnpj}/${dateStr}-exec-${execucaoId}-empresa-${empresaId}.pdf`;
            const buffer = Buffer.from(pdfBase64, 'base64');
            await (0, r2_1.uploadFileToR2)(buffer, pdfR2Key, 'application/pdf');
        }
        const guias = extractGuias(result);
        for (const g of guias) {
            const competencia = resolveCompetencia(g);
            const valor = parseValor(g.valor ?? g.valorTotal ?? g.valorPrincipal);
            const vencimento = parseDateToIso(g.vencimento ?? g.dataVencimento ?? g.dtVencimento);
            const codigoBarras = (g.codigoBarras ?? g.codigo_barras ?? g.linhaDigitavel ?? null);
            await (0, db_1.query)(`INSERT INTO integra_guias
                    (empresa_id, tipo, competencia, valor, vencimento, codigo_barras, dados_originais, status_pagamento, pdf_r2_key)
                 VALUES
                    ($1, 'das_mei', $2, $3, $4, $5, $6::jsonb, 'pendente', $7)
                 ON CONFLICT (empresa_id, tipo, competencia)
                 DO UPDATE SET
                    valor = COALESCE(EXCLUDED.valor, integra_guias.valor),
                    vencimento = COALESCE(EXCLUDED.vencimento, integra_guias.vencimento),
                    codigo_barras = COALESCE(EXCLUDED.codigo_barras, integra_guias.codigo_barras),
                    dados_originais = COALESCE(EXCLUDED.dados_originais, integra_guias.dados_originais),
                    pdf_r2_key = COALESCE(EXCLUDED.pdf_r2_key, integra_guias.pdf_r2_key)`, [
                empresaId,
                competencia,
                valor,
                vencimento,
                codigoBarras,
                JSON.stringify(g),
                pdfR2Key,
            ]);
        }
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, dados_resposta)
             VALUES ($1, $2, 'success', $3)`, [execucaoId, empresaId, JSON.stringify(result)]);
        return 'success';
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, mensagem)
             VALUES ($1, $2, 'error', $3)`, [execucaoId, empresaId, msg]);
        return 'error';
    }
}
function startPgmeiWorker() {
    const worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
        const { execucaoId, empresaId } = job.data;
        const log = logger_1.cronLogger;
        let querySql = `SELECT id, cnpj FROM integra_empresas WHERE ativo = true AND servicos_habilitados ? 'PGMEI'`;
        const queryParams = [];
        if (empresaId) {
            querySql += ` AND id = $1`;
            queryParams.push(empresaId);
        }
        const empresas = await (0, db_1.query)(querySql, queryParams);
        const total = empresas.rows.length;
        let sucesso = 0, falhas = 0, ignoradas = 0;
        await (0, db_1.query)(`UPDATE integra_execucoes SET total_empresas = $1 WHERE id = $2`, [total, execucaoId]);
        // Processar em lotes de CONCURRENCY
        for (let i = 0; i < empresas.rows.length; i += CONCURRENCY) {
            const lote = empresas.rows.slice(i, i + CONCURRENCY);
            const resultados = await Promise.all(lote.map(e => processEmpresa(execucaoId, e.id, e.cnpj)));
            for (const r of resultados) {
                if (r === 'success')
                    sucesso++;
                else if (r === 'error')
                    falhas++;
                else
                    ignoradas++;
            }
            // Backoff entre lotes para evitar throttle do Serpro
            if (i + CONCURRENCY < empresas.rows.length) {
                await new Promise(res => setTimeout(res, 1500));
            }
        }
        const concluido = new Date();
        await (0, db_1.query)(`UPDATE integra_execucoes
                 SET status = $1, concluido_em = $2, sucesso = $3, falhas = $4, ignoradas = $5,
                     duracao_ms = EXTRACT(EPOCH FROM ($2 - iniciado_em)) * 1000
                 WHERE id = $6`, [falhas === 0 ? 'completed' : sucesso > 0 ? 'partial' : 'failed',
            concluido, sucesso, falhas, ignoradas, execucaoId]);
        log.info(`[PGMEI] Execução ${execucaoId} finalizada — ${sucesso} ok, ${falhas} erros`);
    }, { connection: (0, redis_1.createRedisConnection)(), concurrency: 1 });
    worker.on('failed', (job, err) => logger_1.cronLogger.error(`[PGMEI] Job falhou:`, err));
    return worker;
}
async function enqueueRoboPgmei(execucaoId, empresaId) {
    await exports.pgmeiQueue.add('run', { execucaoId, empresaId }, { jobId: `pgmei-${execucaoId}` });
}
//# sourceMappingURL=job-pgmei.js.map