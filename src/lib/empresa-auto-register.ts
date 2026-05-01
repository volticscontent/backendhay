import { query } from './db';
import { getChatHistory } from './chat-history';
import OpenAI from 'openai';
import logger from './logger';

const log = logger.child('EmpresaAutoRegister');

const PRESETS: Record<string, string[]> = {
    mei:       ['PGMEI', 'CCMEI_DADOS', 'CAIXAPOSTAL'],
    simples:   ['PGDASD', 'DEFIS', 'PARCELAMENTO_SN_CONSULTAR', 'CND', 'CAIXAPOSTAL'],
    presumido: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
    real:      ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
};

const VALID_REGIMES = ['mei', 'simples', 'presumido', 'real'];

/**
 * Cria empresa em integra_empresas logo após procuração ser confirmada.
 * Usa dados já disponíveis em leads (cnpj_ativo || cnpj, razao_social).
 * Idempotente via ON CONFLICT DO NOTHING.
 */
export async function autoRegisterEmpresa(
    leadId: number,
): Promise<{ empresaId: number | null; phone: string | null }> {
    try {
        const { rows } = await query(
            `SELECT id, telefone, cnpj, cnpj_ativo, razao_social, nome_completo
             FROM leads WHERE id = $1`,
            [leadId],
        );
        if (!rows.length) return { empresaId: null, phone: null };

        const lead = rows[0] as {
            id: number;
            telefone: string;
            cnpj: string | null;
            cnpj_ativo: string | null;
            razao_social: string | null;
            nome_completo: string | null;
        };

        const cnpj = ((lead.cnpj_ativo || lead.cnpj) ?? '').replace(/\D/g, '');
        if (cnpj.length !== 14) {
            log.warn(`[autoRegisterEmpresa] Lead ${leadId} sem CNPJ válido — empresa não criada`);
            return { empresaId: null, phone: lead.telefone };
        }

        const razaoSocial = lead.razao_social || lead.nome_completo || 'Empresa sem nome';

        const res = await query(
            `INSERT INTO integra_empresas
                (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados, lead_id)
             VALUES ($1, $2, 'mei', true, $3, $4)
             ON CONFLICT (cnpj) DO NOTHING
             RETURNING id`,
            [cnpj, razaoSocial, JSON.stringify(PRESETS.mei), leadId],
        );

        const empresaId: number | null = (res.rows[0]?.id as number | undefined) ?? null;

        if (empresaId) {
            log.info(`[autoRegisterEmpresa] Empresa criada: CNPJ ${cnpj} → id ${empresaId}`);
        } else {
            log.info(`[autoRegisterEmpresa] CNPJ ${cnpj} já existe em integra_empresas — ignorado`);
        }

        return { empresaId, phone: lead.telefone };
    } catch (err) {
        log.error('[autoRegisterEmpresa] Erro:', err);
        return { empresaId: null, phone: null };
    }
}

/**
 * Enriquece empresa recém-criada com regime e certificado inferidos via GPT-4o-mini.
 * Fire-and-forget: falha silenciosamente, nunca propaga exceção.
 */
export async function enrichEmpresaFromChat(empresaId: number, phone: string): Promise<void> {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'dummy-key') {
            log.warn('[enrichEmpresaFromChat] OPENAI_API_KEY ausente — enriquecimento ignorado');
            return;
        }

        const history = await getChatHistory(phone, 30);
        if (!history.length) return;

        const openai = new OpenAI({ apiKey });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        'Você é um Analista Fiscal. Leia o histórico de conversa WhatsApp e extraia dados da empresa do cliente.\n' +
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

        const parsed = JSON.parse(completion.choices[0].message.content || '{}') as {
            regime_tributario?: string | null;
            certificado_validade?: string | null;
        };

        const updates: string[] = [];
        const values: unknown[] = [];

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
        await query(
            `UPDATE integra_empresas SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
            values,
        );

        log.info(`[enrichEmpresaFromChat] Empresa ${empresaId} enriquecida: ${updates.map((u, i) => `${u.split(' = ')[0]}=${values[i]}`).join(', ')}`);
    } catch (err) {
        log.error('[enrichEmpresaFromChat] Erro (fire-and-forget):', err);
    }
}
