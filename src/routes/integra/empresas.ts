import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';

const router = Router();

const PRESETS: Record<string, string[]> = {
    mei:       ['PGMEI', 'CCMEI_DADOS', 'CAIXAPOSTAL'],
    simples:   ['PGDASD', 'DEFIS', 'PARCELAMENTO_SN_CONSULTAR', 'CND', 'CAIXAPOSTAL'],
    presumido: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
    real:      ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
};

// GET /integra/empresas
router.get('/integra/empresas', async (_req: Request, res: Response) => {
    try {
        const result = await query(
            `SELECT ie.id, ie.cnpj, ie.razao_social, ie.regime_tributario, ie.ativo,
                    ie.servicos_habilitados, ie.lead_id, ie.certificado_validade, ie.observacoes,
                    ie.created_at, ie.updated_at,
                    l.nome_completo AS lead_nome,
                    l.telefone     AS lead_telefone
             FROM integra_empresas ie
             LEFT JOIN leads l ON ie.lead_id = l.id
             ORDER BY ie.razao_social ASC`
        );
        res.json(result.rows);
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// GET /integra/empresas/:id
router.get('/integra/empresas/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(`SELECT * FROM integra_empresas WHERE id = $1`, [id]);
        if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });
        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// POST /integra/empresas
router.post('/integra/empresas', async (req: Request, res: Response) => {
    try {
        const { cnpj, razao_social, regime_tributario = 'mei', ativo = true,
                servicos_habilitados, lead_id, certificado_validade, observacoes } = req.body as {
            cnpj: string; razao_social: string; regime_tributario?: string;
            ativo?: boolean; servicos_habilitados?: string[];
            lead_id?: number; certificado_validade?: string; observacoes?: string;
        };

        if (!cnpj || !razao_social) {
            return void res.status(400).json({ error: 'cnpj e razao_social são obrigatórios' });
        }

        const servicos = servicos_habilitados ?? PRESETS[regime_tributario] ?? PRESETS.mei;

        // Se veio com lead_id, buscar razao_social real do lead para evitar gravar nome_completo como razão social
        let finalRazaoSocial = razao_social;
        if (lead_id) {
            const leadRow = await query(`SELECT razao_social FROM leads WHERE id = $1`, [lead_id]);
            const leadRazao = leadRow.rows[0]?.razao_social as string | null | undefined;
            if (leadRazao) finalRazaoSocial = leadRazao;
        }

        const result = await query(
            `INSERT INTO integra_empresas
               (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados, lead_id, certificado_validade, observacoes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [cnpj, finalRazaoSocial, regime_tributario, ativo, JSON.stringify(servicos), lead_id ?? null, certificado_validade ?? null, observacoes ?? null]
        );

        // Garantir que leads.razao_social esteja preenchido com o valor usado
        if (lead_id) {
            await query(
                `UPDATE leads SET razao_social = COALESCE(razao_social, $1), atualizado_em = NOW() WHERE id = $2`,
                [finalRazaoSocial, lead_id]
            );
        }

        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// PATCH /integra/empresas/:id
router.patch('/integra/empresas/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const fields = req.body as Record<string, unknown>;

        const allowed = ['razao_social', 'regime_tributario', 'ativo', 'servicos_habilitados',
                         'lead_id', 'certificado_validade', 'observacoes'];
        const updates: string[] = [];
        const values: unknown[] = [];

        for (const key of allowed) {
            if (key in fields) {
                values.push(key === 'servicos_habilitados' ? JSON.stringify(fields[key]) : fields[key]);
                updates.push(`${key} = $${values.length}`);
            }
        }

        if (updates.length === 0) return void res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

        values.push(id);
        const result = await query(
            `UPDATE integra_empresas SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${values.length} RETURNING *`,
            values
        );

        if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });

        // Sincronizar razao_social de volta ao lead quando atualizada (integra_empresas é fonte de verdade fiscal)
        const updated = result.rows[0] as { lead_id?: number; razao_social?: string };
        if ('razao_social' in fields && updated.lead_id) {
            await query(
                `UPDATE leads SET razao_social = $1, atualizado_em = NOW() WHERE id = $2`,
                [updated.razao_social, updated.lead_id]
            );
        }

        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// DELETE /integra/empresas/:id
router.delete('/integra/empresas/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query(`DELETE FROM integra_empresas WHERE id = $1 RETURNING id`, [id]);
        if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });
        res.json({ deleted: true });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// GET /integra/leads-para-importar — leads com CNPJ que ainda não estão em integra_empresas
router.get('/integra/leads-para-importar', async (_req: Request, res: Response) => {
    try {
        const result = await query(`
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
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// === ROTA TEMPORÁRIA E2E ===
// GET /integra/test-run — Executa a rotina de Geração MANUAL para a empresa MOCK de teste
router.get('/integra/test-run', async (req: Request, res: Response) => {
    try {
        const empresa = await query(`SELECT id FROM integra_empresas WHERE cnpj = '00000000000191' AND ativo = true`);
        if (!empresa.rows.length) return void res.status(404).json({ error: 'Empresa Mock E2E não encontrada' });
        
        const empresaId = empresa.rows[0].id as number;
        
        const exec = await query(
            `INSERT INTO integra_execucoes (robo_tipo, status) VALUES ('pgmei', 'running') RETURNING id`
        );
        const execucaoId = exec.rows[0].id as number;
        
        // Dynamic import workaround to avoid circular/unresolved deps if any
        const job = await import('../../queues/integra/job-pgmei');
        await job.enqueueRoboPgmei(execucaoId, empresaId);
        
        res.status(202).json({ 
            message: '🚀 Teste End-to-End Iniciado. O Job PGMEI foi enfileirado para o MOCK!', 
            execucao_id: execucaoId, 
            empresa_id: empresaId 
        });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
});

// GET /integra/analyze-chat/:phone — Analisa histórico de mensagens e preenche pré-form de empresa
import { getChatHistory } from '../../lib/chat-history';
import OpenAI from 'openai';
router.get('/integra/analyze-chat/:phone', async (req: Request, res: Response) => {
    try {
        const { phone } = req.params;
        const history = await getChatHistory(phone, 30); // Ultimas 30 interações para contexto
        
        if (!history || history.length === 0) {
            return void res.status(404).json({ error: 'Nenhum histórico encontrado para este número.' });
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy-key' });
        
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
    } catch (err: any) {
        console.error('[analyze-chat] Erro:', err);
        res.status(500).json({ error: err?.message ?? 'Erro na compilação do RAG' });
    }
});

// GET /integra/empresas/presets/:regime — retorna preset de serviços
router.get('/integra/presets/:regime', (req: Request, res: Response) => {
    const { regime } = req.params;
    const preset = PRESETS[regime as keyof typeof PRESETS];
    if (!preset) return void res.status(400).json({ error: 'Regime inválido' });
    res.json(preset);
});

export default router;
