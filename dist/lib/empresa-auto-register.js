"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoRegisterEmpresa = autoRegisterEmpresa;
exports.enrichEmpresaFromChat = enrichEmpresaFromChat;
const db_1 = require("./db");
const chat_history_1 = require("./chat-history");
const openai_1 = __importDefault(require("openai"));
const logger_1 = __importDefault(require("./logger"));
const log = logger_1.default.child('EmpresaAutoRegister');
const PRESETS = {
    mei: ['PGMEI', 'CCMEI_DADOS', 'CAIXAPOSTAL'],
    simples: ['PGDASD', 'DEFIS', 'PARCELAMENTO_SN_CONSULTAR', 'CND', 'CAIXAPOSTAL'],
    presumido: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
    real: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
};
const VALID_REGIMES = ['mei', 'simples', 'presumido', 'real'];
/**
 * Cria empresa em integra_empresas logo após procuração ser confirmada.
 * Usa dados já disponíveis em leads (cnpj, razao_social).
 * Idempotente via ON CONFLICT DO NOTHING.
 */
async function autoRegisterEmpresa(leadId) {
    try {
        const { rows } = await (0, db_1.query)(`SELECT id, telefone, cnpj, razao_social, nome_completo
             FROM leads WHERE id = $1`, [leadId]);
        if (!rows.length)
            return { empresaId: null, phone: null };
        const lead = rows[0];
        const cnpj = (lead.cnpj ?? '').replace(/\D/g, '');
        if (cnpj.length !== 14) {
            log.warn(`[autoRegisterEmpresa] Lead ${leadId} sem CNPJ válido — empresa não criada`);
            return { empresaId: null, phone: lead.telefone };
        }
        const razaoSocial = lead.razao_social || lead.nome_completo || 'Empresa sem nome';
        const res = await (0, db_1.query)(`INSERT INTO integra_empresas
                (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados, lead_id)
             VALUES ($1, $2, 'mei', true, $3, $4)
             ON CONFLICT (cnpj) DO NOTHING
             RETURNING id`, [cnpj, razaoSocial, JSON.stringify(PRESETS.mei), leadId]);
        const empresaId = res.rows[0]?.id ?? null;
        if (empresaId) {
            log.info(`[autoRegisterEmpresa] Empresa criada: CNPJ ${cnpj} → id ${empresaId}`);
        }
        else {
            log.info(`[autoRegisterEmpresa] CNPJ ${cnpj} já existe em integra_empresas — ignorado`);
        }
        return { empresaId, phone: lead.telefone };
    }
    catch (err) {
        log.error('[autoRegisterEmpresa] Erro:', err);
        return { empresaId: null, phone: null };
    }
}
/**
 * Enriquece empresa recém-criada com regime e certificado inferidos via GPT-4o-mini.
 * Fire-and-forget: falha silenciosamente, nunca propaga exceção.
 */
async function enrichEmpresaFromChat(empresaId, phone) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'dummy-key') {
            log.warn('[enrichEmpresaFromChat] OPENAI_API_KEY ausente — enriquecimento ignorado');
            return;
        }
        const history = await (0, chat_history_1.getChatHistory)(phone, 30);
        if (!history.length)
            return;
        const openai = new openai_1.default({ apiKey });
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'Você é um Analista Fiscal. Leia o histórico de conversa WhatsApp e extraia dados da empresa do cliente.\n' +
                        'Devolva RIGOROSAMENTE um JSON com estas chaves (use null se a informação não estiver presente):\n' +
                        '- regime_tributario: "mei" | "simples" | "presumido" | "real" (null se não mencionado)\n' +
                        '- certificado_validade: "YYYY-MM-DD" se o cliente mencionou que possui certificado A1 e informou a validade (null caso contrário)',
                },
                {
                    role: 'user',
                    content: 'Histórico:\n' + history.map(h => `${h.role}: ${h.content}`).join('\n'),
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
        });
        const parsed = JSON.parse(completion.choices[0].message.content || '{}');
        const updates = [];
        const values = [];
        if (parsed.regime_tributario && VALID_REGIMES.includes(parsed.regime_tributario)) {
            values.push(parsed.regime_tributario);
            updates.push(`regime_tributario = $${values.length}`);
            values.push(JSON.stringify(PRESETS[parsed.regime_tributario]));
            updates.push(`servicos_habilitados = $${values.length}`);
        }
        if (parsed.certificado_validade && /^\d{4}-\d{2}-\d{2}$/.test(parsed.certificado_validade)) {
            values.push(parsed.certificado_validade);
            updates.push(`certificado_validade = $${values.length}`);
        }
        if (!updates.length) {
            log.info(`[enrichEmpresaFromChat] Nenhum dado extra extraído para empresa ${empresaId}`);
            return;
        }
        values.push(empresaId);
        await (0, db_1.query)(`UPDATE integra_empresas SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
        log.info(`[enrichEmpresaFromChat] Empresa ${empresaId} enriquecida: ${updates.map((u, i) => `${u.split(' = ')[0]}=${values[i]}`).join(', ')}`);
    }
    catch (err) {
        log.error('[enrichEmpresaFromChat] Erro (fire-and-forget):', err);
    }
}
//# sourceMappingURL=empresa-auto-register.js.map