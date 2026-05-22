"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../lib/db");
const router = (0, express_1.Router)();
const PRESETS = {
    mei: ['PGMEI', 'CCMEI_DADOS', 'CAIXAPOSTAL'],
    simples: ['PGDASD', 'DEFIS', 'PARCELAMENTO_SN_CONSULTAR', 'CND', 'CAIXAPOSTAL'],
    presumido: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
    real: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
};
// GET /integra/empresas
router.get('/integra/empresas', async (req, res) => {
    try {
        const search = String(req.query.search ?? '').trim();
        const regime = String(req.query.regime ?? '').trim().toLowerCase();
        const ativoRaw = String(req.query.ativo ?? '').trim().toLowerCase();
        const leadIdRaw = String(req.query.lead_id ?? '').trim();
        const certVencendoRaw = String(req.query.cert_vencendo ?? '').trim().toLowerCase();
        const servico = String(req.query.servico ?? '').trim();
        const limitRaw = Number(req.query.limit ?? 200);
        const offsetRaw = Number(req.query.offset ?? 0);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
        const where = [];
        const values = [];
        if (search) {
            const numeric = search.replace(/\D/g, '');
            values.push(`%${search}%`);
            const searchParam = `$${values.length}`;
            if (numeric.length >= 6) {
                values.push(`%${numeric}%`);
                const cnpjParam = `$${values.length}`;
                where.push(`(ie.razao_social ILIKE ${searchParam} OR l.nome_completo ILIKE ${searchParam} OR ie.cnpj ILIKE ${cnpjParam})`);
            }
            else {
                where.push(`(ie.razao_social ILIKE ${searchParam} OR l.nome_completo ILIKE ${searchParam})`);
            }
        }
        if (regime && ['mei', 'simples', 'presumido', 'real'].includes(regime)) {
            values.push(regime);
            where.push(`ie.regime_tributario = $${values.length}`);
        }
        if (ativoRaw === 'true' || ativoRaw === 'false') {
            values.push(ativoRaw === 'true');
            where.push(`ie.ativo = $${values.length}`);
        }
        if (leadIdRaw && /^\d+$/.test(leadIdRaw)) {
            values.push(Number(leadIdRaw));
            where.push(`ie.lead_id = $${values.length}`);
        }
        if (certVencendoRaw === 'true') {
            where.push(`ie.certificado_validade IS NOT NULL AND ie.certificado_validade <= (CURRENT_DATE + INTERVAL '30 day')`);
        }
        if (servico) {
            values.push(servico);
            where.push(`ie.servicos_habilitados ? $${values.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        values.push(limit);
        const limitParam = `$${values.length}`;
        values.push(offset);
        const offsetParam = `$${values.length}`;
        const result = await (0, db_1.query)(`SELECT ie.id, ie.cnpj, ie.razao_social, ie.regime_tributario, ie.ativo,
                    ie.servicos_habilitados, ie.lead_id, ie.certificado_validade, ie.observacoes,
                    ie.created_at, ie.updated_at,
                    l.nome_completo AS lead_nome,
                    l.telefone     AS lead_telefone
             FROM integra_empresas ie
             LEFT JOIN leads l ON ie.lead_id = l.id
             ${whereSql}
             ORDER BY ie.razao_social ASC
             LIMIT ${limitParam} OFFSET ${offsetParam}`, values);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// GET /integra/empresas/:id
router.get('/integra/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await (0, db_1.query)(`SELECT * FROM integra_empresas WHERE id = $1`, [id]);
        if (result.rows.length === 0)
            return void res.status(404).json({ error: 'Empresa não encontrada' });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// POST /integra/empresas
router.post('/integra/empresas', async (req, res) => {
    try {
        const { cnpj, razao_social, regime_tributario = 'mei', ativo = true, servicos_habilitados, lead_id, certificado_validade, observacoes } = req.body;
        if (!cnpj || !razao_social) {
            return void res.status(400).json({ error: 'cnpj e razao_social são obrigatórios' });
        }
        const servicos = servicos_habilitados ?? PRESETS[regime_tributario] ?? PRESETS.mei;
        const result = await (0, db_1.query)(`INSERT INTO integra_empresas
               (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados, lead_id, certificado_validade, observacoes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`, [cnpj, razao_social, regime_tributario, ativo, JSON.stringify(servicos), lead_id ?? null, certificado_validade ?? null, observacoes ?? null]);
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// PATCH /integra/empresas/:id
router.patch('/integra/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['razao_social', 'regime_tributario', 'ativo', 'servicos_habilitados',
            'lead_id', 'certificado_validade', 'observacoes'];
        const updates = [];
        const values = [];
        for (const key of allowed) {
            if (key in fields) {
                values.push(key === 'servicos_habilitados' ? JSON.stringify(fields[key]) : fields[key]);
                updates.push(`${key} = $${values.length}`);
            }
        }
        if (updates.length === 0)
            return void res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
        values.push(id);
        const result = await (0, db_1.query)(`UPDATE integra_empresas SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${values.length} RETURNING *`, values);
        if (result.rows.length === 0)
            return void res.status(404).json({ error: 'Empresa não encontrada' });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// DELETE /integra/empresas/:id
router.delete('/integra/empresas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await (0, db_1.query)(`DELETE FROM integra_empresas WHERE id = $1 RETURNING id`, [id]);
        if (result.rows.length === 0)
            return void res.status(404).json({ error: 'Empresa não encontrada' });
        res.json({ deleted: true });
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// GET /integra/leads-para-importar — leads com CNPJ que ainda não estão em integra_empresas
router.get('/integra/leads-para-importar', async (_req, res) => {
    try {
        const result = await (0, db_1.query)(`
            SELECT
                l.id,
                l.nome_completo,
                l.razao_social,
                REGEXP_REPLACE(l.cnpj, '[^0-9]', '', 'g') AS cnpj,
                l.email,
                l.telefone,
                COALESCE(lp.procuracao_ativa, false) AS procuracao_ativa
            FROM leads l
            LEFT JOIN leads_processo lp ON l.id = lp.lead_id
            WHERE l.cnpj IS NOT NULL AND l.cnpj != ''
              AND REGEXP_REPLACE(l.cnpj, '[^0-9]', '', 'g') NOT IN (
                  SELECT cnpj FROM integra_empresas
              )
            ORDER BY COALESCE(lp.procuracao_ativa, false) DESC, l.nome_completo ASC
            LIMIT 200
        `);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// === ROTA TEMPORÁRIA E2E ===
// GET /integra/test-run — Executa a rotina de Geração MANUAL para a empresa MOCK de teste
router.get('/integra/test-run', async (req, res) => {
    try {
        const empresa = await (0, db_1.query)(`SELECT id FROM integra_empresas WHERE cnpj = '00000000000191' AND ativo = true`);
        if (!empresa.rows.length)
            return void res.status(404).json({ error: 'Empresa Mock E2E não encontrada' });
        const empresaId = empresa.rows[0].id;
        const exec = await (0, db_1.query)(`INSERT INTO integra_execucoes (robo_tipo, status) VALUES ('pgmei', 'running') RETURNING id`);
        const execucaoId = exec.rows[0].id;
        // Dynamic import workaround to avoid circular/unresolved deps if any
        const job = await Promise.resolve().then(() => __importStar(require('../../queues/integra/job-pgmei')));
        await job.enqueueRoboPgmei(execucaoId, empresaId);
        res.status(202).json({
            message: '🚀 Teste End-to-End Iniciado. O Job PGMEI foi enfileirado para o MOCK!',
            execucao_id: execucaoId,
            empresa_id: empresaId
        });
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});
// GET /integra/analyze-chat/:phone — Analisa histórico de mensagens e preenche pré-form de empresa
const chat_history_1 = require("../../lib/chat-history");
const openai_1 = __importDefault(require("openai"));
router.get('/integra/analyze-chat/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const history = await (0, chat_history_1.getChatHistory)(phone, 30); // Ultimas 30 interações para contexto
        if (!history || history.length === 0) {
            return void res.status(404).json({ error: 'Nenhum histórico encontrado para este número.' });
        }
        const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY || 'dummy-key' });
        const systemPrompt = `Você é um Analista Fiscal especializado na plataforma Integra Contador.
        Seu objetivo é ler o histórico da conversa entre o cliente e o bot (Apolo) e extrair os dados da empresa.
        Devolva RIGOROSAMENTE um JSON com as seguintes chaves (use null se a informação não estiver presente na conversa):
        - cnpj: string (somente números)
        - razao_social: string (nome da empresa, se mencionado)
        - regime_tributario: string ("mei", "simples", "presumido" ou "real")
        - certificado_validade: string (formato YYYY-MM-DD se o usuário disse que possui certificado A1 e enviou a data, senao null)
        - servicos_habilitados: array de strings (quais os escopos fiscais deveríamos habilitar se basear em pedido do cliente ex: ["PGMEI", "CND"] ou deixe null pro sistema decidir)`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Histórico:\n' + history.map(h => `${h.role}: ${h.content}`).join('\n') }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1
        });
        const jsonStr = completion.choices[0].message.content || '{}';
        const parsedData = JSON.parse(jsonStr);
        res.json({
            status: 'success',
            extracted_form: parsedData,
            analyzed_messages: history.length
        });
    }
    catch (err) {
        console.error('[analyze-chat] Erro:', err);
        res.status(500).json({ error: err?.message ?? 'Erro na compilação do RAG' });
    }
});
// GET /integra/empresas/presets/:regime — retorna preset de serviços
router.get('/integra/presets/:regime', (req, res) => {
    const { regime } = req.params;
    const preset = PRESETS[regime];
    if (!preset)
        return void res.status(400).json({ error: 'Regime inválido' });
    res.json(preset);
});
exports.default = router;
//# sourceMappingURL=empresas.js.map