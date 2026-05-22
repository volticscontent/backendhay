import cron from 'node-cron';
import pool from '../lib/db';
import redis from '../lib/redis';
import { enqueueMessages } from '../queues/message-queue';
import { cronLogger } from '../lib/logger';
import { isWithinBusinessHours } from '../lib/business-hours';
import { normalizePhone } from '../lib/utils';
import { evolutionGetConnectionState, evolutionConnectInstance } from '../lib/evolution';
import { enqueueRoboPgmei } from '../queues/integra/job-pgmei';
import { enqueueRoboCnd } from '../queues/integra/job-cnd';
import { enqueueRoboCaixaPostal } from '../queues/integra/job-caixa-postal';

const INTEGRA_ENQUEUE: Record<string, (id: number) => Promise<void>> = {
    pgmei:        enqueueRoboPgmei,
    cnd:          enqueueRoboCnd,
    caixa_postal: enqueueRoboCaixaPostal,
};

/**
 * Registra todos os CRON jobs do sistema
 */
export function registerCronJobs(): void {
    cronLogger.info('Registrando jobs...');

    // ============================
    // 1. Context Sync — REMOVIDO
    //    Nudges de inatividade agora são gerenciados pelo BullMQ follow-up queue
    //    (scheduleFollowUp em message-debounce.ts) com timer de 5 minutos.
    // ============================

    // ============================
    // 2. Follow-up de Inatividade — A cada 30 minutos
    //    Sequência multi-etapa por lead: warm → urgência → última chance → NUTRICAO
    // ============================
    cron.schedule('*/30 * * * *', async () => {
        const log = cronLogger.withTrace(`cron-followup-${Date.now().toString(36)}`);

        if (!isWithinBusinessHours()) {
            log.debug('Follow-up Inatividade - Fora do horário comercial, pulando.');
            return;
        }

        log.info('Follow-up Inatividade - Iniciando...');
        const timer = log.timer('Cron Follow-up Total');
        const client = await pool.connect();
        try {
            const res = await log.timed('Query leads inativos', () => client.query(`
                SELECT l.id, l.telefone, l.nome_completo, l.situacao,
                       l.cnpj,
                       lp.status_atendimento, lp.data_followup
                FROM leads l
                LEFT JOIN leads_processo lp ON l.id = lp.lead_id
                WHERE l.situacao NOT IN ('cliente', 'desqualificado', 'nutricao')
                  AND l.data_cadastro < NOW() - INTERVAL '2 hours'
                  AND (lp.data_followup IS NULL OR lp.data_followup < NOW() - INTERVAL '6 hours')
                LIMIT 10
            `));

            if (res.rows.length === 0) {
                log.info('Nenhum lead para follow-up no momento.');
                timer.end('Sem leads');
                return;
            }

            log.info(`Follow-up - ${res.rows.length} leads para contatar`);

            const attendantPhone = process.env.ATTENDANT_PHONE;
            let count = 0;

            for (const lead of res.rows) {
                try {
                    const phone = normalizePhone(lead.telefone || '');
                    if (!phone || phone.length < 10) {
                        log.debug(`Follow-up - Telefone inválido, pulando: ${lead.telefone}`);
                        continue;
                    }

                    // Pula se o cliente respondeu nas últimas 2 horas (já está ativo)
                    const lastActivity = await redis.get(`last_activity:${phone}`);
                    if (lastActivity && Date.now() - parseInt(lastActivity, 10) < 2 * 60 * 60 * 1000) {
                        log.debug(`Follow-up pulado — ${phone} ativo nas últimas 2h`);
                        continue;
                    }

                    const nome = (lead.nome_completo || 'Cliente').split(' ')[0];
                    const temCnpj = Boolean(lead.cnpj);
                    const statusAtendimento = lead.status_atendimento as string | null;

                    // Busca e incrementa o contador de tentativas no Redis
                    const redisKey = `followup_count:${phone}`;
                    const countRaw = await redis.get(redisKey);
                    const attempt = (parseInt(countRaw || '0', 10) || 0) + 1;
                    await redis.set(redisKey, String(attempt), 'EX', 60 * 60 * 24 * 14); // TTL 14 dias

                    if (attempt > 3) {
                        // Etapa 4+: encerrar follow-up, marcar como NUTRICAO
                        await client.query(
                            `UPDATE leads SET situacao = 'nutricao', atualizado_em = NOW() WHERE id = $1`,
                            [lead.id]
                        );
                        await client.query(`
                            INSERT INTO leads_processo (lead_id, data_followup)
                            VALUES ($1, NOW())
                            ON CONFLICT (lead_id) DO UPDATE SET data_followup = NOW(), updated_at = NOW()
                        `, [lead.id]);
                        await redis.del(redisKey);

                        if (attendantPhone) {
                            await enqueueMessages({
                                phone: attendantPhone,
                                messages: [{ content: `📭 *Lead movido para Nutrição*\n\nNome: ${lead.nome_completo || lead.telefone}\nTelefone: ${phone}\n\nApós 3 tentativas de follow-up sem resposta, o lead foi marcado como *Nutrição*. Caso queira reativar manualmente, acesse o painel.`, type: 'text', delay: 0 }],
                                context: 'cron-nutricao'
                            });
                        }
                        log.info(`Lead ${phone} movido para NUTRICAO após 3 tentativas`);
                        count++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    // Escolhe a mensagem baseada na etapa e no contexto do lead
                    let msg: string;

                    if (attempt === 1) {
                        // Etapa 1: Retomada calorosa
                        if (statusAtendimento === 'reuniao_pendente' || statusAtendimento === 'reuniao_fechamento') {
                            msg = `Oi ${nome}! 😊 Vi que você tem uma reunião agendada com a gente. Precisa de alguma informação antes ou quer confirmar o horário?`;
                        } else if (temCnpj) {
                            msg = `Oi ${nome}! 😊 Vi aqui que ainda não conseguimos dar continuidade à análise do seu MEI. Ainda quer que a gente dê uma olhada na situação fiscal?`;
                        } else {
                            msg = `Oi ${nome}! 😊 Vi que você se interessou pelos nossos serviços. Ainda posso te ajudar com alguma dúvida?`;
                        }
                    } else if (attempt === 2) {
                        // Etapa 2: Urgência e custo de inação
                        if (temCnpj) {
                            msg = `Oi ${nome}, tudo bem? Cada mês de DAS em aberto acumula multa de 0,33% ao dia + SELIC — quanto mais demora, mais caro fica. 😟\n\nPosso verificar a situação do seu MEI agora e mostrar exatamente o que precisa resolver. Pode ser?`;
                        } else {
                            msg = `Oi ${nome}! Só lembrando que regularizar um MEI fica cada vez mais caro com o tempo — cada guia em aberto acumula multa diária. 😟\n\nA gente pode resolver isso de forma prática. Quer que eu explique como funciona?`;
                        }
                    } else {
                        // Etapa 3: Última chance, pergunta direta
                        msg = `Oi ${nome}, última mensagem de nossa parte. 🙏\n\nVocê ainda quer resolver a situação do seu MEI? Responde só *sim* ou *não* — te respondo na hora.`;
                    }

                    await enqueueMessages({
                        phone,
                        messages: [{ content: msg, type: 'text', delay: 0 }],
                        context: `cron-follow-up-etapa${attempt}`
                    });

                    await client.query(`
                        INSERT INTO leads_processo (lead_id, data_followup)
                        VALUES ($1, NOW())
                        ON CONFLICT (lead_id) DO UPDATE SET data_followup = NOW(), updated_at = NOW()
                    `, [lead.id]);

                    log.info(`Follow-up etapa ${attempt} enviado para ${phone}`);
                    count++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (err) {
                    log.error(`Erro no follow-up de ${lead.telefone}:`, err);
                }
            }
            timer.end(`${count} follow-ups enviados`);
        } catch (error) {
            log.error('Follow-up Error:', error);
            timer.end('Erro');
        } finally {
            client.release();
        }
    });

    // ============================
    // 3. Limpeza de Cache Redis — Diariamente às 3:00 AM
    // ============================
    cron.schedule('0 3 * * *', async () => {
        const log = cronLogger.withTrace(`cron-clean-${Date.now().toString(36)}`);
        log.info('Limpeza noturna - Iniciando...');
        const timer = log.timer('Limpeza Noturna');
        try {
            // Limpar histórico de chat antigo (> 7 dias)
            const result = await pool.query(
                `DELETE FROM chat_history WHERE created_at < NOW() - INTERVAL '7 days'`
            );
            log.info(`Limpeza - ${result.rowCount} mensagens de chat removidas`);
            timer.end(`${result.rowCount} msg removidas`);
        } catch (error) {
            log.error('Limpeza Error:', error);
            timer.end('Erro na limpeza');
        }
    });

    // ============================
    // 4. Relatório Diário — Às 8:00 AM
    //    Envia resumo de atividade para o atendente
    // ============================
    cron.schedule('0 8 * * *', async () => {
        const log = cronLogger.withTrace(`cron-report-${Date.now().toString(36)}`);
        log.info('Relatório Diário - Gerando...');
        const timer = log.timer('Relatório Diário Total');

        const client = await pool.connect();
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const [newLeads, qualifiedLeads, meetings] = await log.timed('Monitoramento de leads e reuniões', () => Promise.all([
                client.query(`SELECT COUNT(*) as count FROM leads WHERE data_cadastro > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads WHERE situacao = 'qualificado' AND atualizado_em > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads_processo WHERE data_reuniao > $1`, [yesterday]),
            ]));

            const report = `📊 *Relatório Diário Haylander*\n\n` +
                `📥 Novos Leads: ${newLeads.rows[0].count}\n` +
                `✅ Qualificados: ${qualifiedLeads.rows[0].count}\n` +
                `📅 Reuniões Agendadas: ${meetings.rows[0].count}\n` +
                `📆 Data: ${new Date().toLocaleDateString('pt-BR')}`;

            const attendantPhone = process.env.ATTENDANT_PHONE;
            if (attendantPhone) {
                await enqueueMessages({
                    phone: attendantPhone,
                    messages: [{ content: report, type: 'text', delay: 0 }],
                    context: 'cron-relatorio-diario'
                });
                log.info('Relatório enviado para a fila');
                timer.end('Relatório enviado');
            } else {
                log.warn('Relatório não enviado: ATTENDANT_PHONE ausente no .env');
                timer.end('Sem ATTENDANT_PHONE');
            }
        } catch (error) {
            log.error('Relatório Error:', error);
            timer.end('Erro no relatório');
        } finally {
            client.release();
        }
    });

    // ============================
    // 5. Evolution API Keep-Alive — A cada 2 minutos
    //    Mantém a instância sincronizada se estiver inativa há mais de 5 minutos
    // ============================
    cron.schedule('*/1 * * * *', async () => {
        const log = cronLogger.withTrace(`cron-keepalive-${Date.now().toString(36)}`);
        
        try {
            const JANELA_MINIMA_MS = 2 * 60 * 1000; // 2 minutos de silêncio
            const lastActivity = await redis.get('evolution:last_activity');
            const now = Date.now();

            if (lastActivity) {
                const diff = now - parseInt(lastActivity, 10);
                if (diff < JANELA_MINIMA_MS) {
                    log.debug(`Keep-alive pulado - Atividade recente há ${Math.round(diff / 1000)}s`);
                    return;
                }
            }

            // Margem de erro (Jitter): 0 a 15 segundos (reduzido para ser mais rápido)
            const jitter = Math.floor(Math.random() * 15000);
            log.info(`Keep-alive necessário - Aguardando jitter de ${Math.round(jitter / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, jitter));

            log.info('Executando keep-alive na Evolution API...');
            const state: any = await evolutionGetConnectionState();
            
            // Extrair status de forma robusta
            const connectionStatus = state?.instance?.state || state?.state || state?.status || state?.instance?.connectionStatus;
            log.info(`Estado da instância: ${connectionStatus || JSON.stringify(state)}`);

            if (connectionStatus !== 'open') {
                log.warn(`⚠️ Instância não está 'open' (status: ${connectionStatus}). Tentando reconectar...`);
                await evolutionConnectInstance();
                log.info('Chamada de reconexão enviada.');
            } else {
                log.info('✅ Instância saudável (open).');
            }
            
            // Atualizar atividade após o poke bem-sucedido
            await redis.set('evolution:last_activity', Date.now().toString());
        } catch (error) {
            log.error('Erro no Keep-alive:', error);
        }
    });

    // ============================
    // 6. Integra Contador — Robôs agendados
    //    Roda toda hora :00, verifica dia + hora na tabela integra_robos
    // ============================
    cron.schedule('0 * * * *', async () => {
        const log = cronLogger.withTrace(`cron-integra-${Date.now().toString(36)}`);
        const now = new Date();
        const diaAtual = now.getDate();
        const horaAtual = now.getHours();

        try {
            const robos = await pool.query(`
                SELECT tipo_robo, hora_execucao
                FROM integra_robos
                WHERE ativo = true
                  AND dia_execucao = $1
            `, [diaAtual]);

            for (const robo of robos.rows) {
                const horaRobo = parseInt(String(robo.hora_execucao).split(':')[0], 10);
                if (horaRobo !== horaAtual) continue;

                const tipo = robo.tipo_robo as string;
                const enqueue = INTEGRA_ENQUEUE[tipo];
                if (!enqueue) {
                    log.warn(`[Integra] Tipo desconhecido: ${tipo}`);
                    continue;
                }

                const exec = await pool.query(
                    `INSERT INTO integra_execucoes (robo_tipo, status)
                     VALUES ($1, 'running') RETURNING id`,
                    [tipo]
                );
                const execucaoId = exec.rows[0].id as number;
                await enqueue(execucaoId);

                await pool.query(
                    `UPDATE integra_robos
                     SET ultima_execucao = NOW(),
                         proxima_execucao = NOW() + interval '1 month',
                         updated_at = NOW()
                     WHERE tipo_robo = $1`,
                    [tipo]
                );

                log.info(`[Integra] Robô ${tipo} disparado — execução ${execucaoId}`);
            }
        } catch (err) {
            log.error('[Integra] Erro ao checar robôs:', err);
        }
    });

    // ============================
    // 7. Confirmação Pós-Reunião — 4x ao dia (12h, 15h, 18h, 21h)
    //    Coleta reuniões de fechamento do dia que ainda não foram confirmadas
    //    e notifica o Haylander para atualizar o status.
    // ============================
    cron.schedule('0 12,15,18,21 * * *', async () => {
        const log = cronLogger.withTrace(`cron-pos-reuniao-${Date.now().toString(36)}`);
        log.info('Confirmação Pós-Reunião - Iniciando...');

        const client = await pool.connect();
        try {
            // Busca reuniões de fechamento com data_reuniao nas últimas 12h
            // que ainda estão com status pendente (não confirmadas como cliente ou perdida)
            const res = await client.query(`
                SELECT
                    l.id, l.telefone, l.nome_completo,
                    lp.data_reuniao, lp.status_atendimento, lp.observacoes
                FROM leads l
                JOIN leads_processo lp ON l.id = lp.lead_id
                WHERE lp.status_atendimento IN ('reuniao_fechamento', 'reuniao_pendente', 'reuniao')
                  AND lp.data_reuniao IS NOT NULL
                  AND lp.data_reuniao <= NOW()
                  AND lp.data_reuniao >= NOW() - INTERVAL '12 hours'
                  AND l.situacao NOT IN ('cliente', 'desqualificado')
                ORDER BY lp.data_reuniao ASC
            `);

            if (res.rows.length === 0) {
                log.info('Nenhuma reunião pendente de confirmação.');
                return;
            }

            const attendantPhone = process.env.ATTENDANT_PHONE;
            if (!attendantPhone) {
                log.warn('ATTENDANT_PHONE não configurado — notificação não enviada.');
                return;
            }

            // Monta resumo das reuniões pendentes para o Haylander
            const linhas = res.rows.map((r, i) => {
                const hora = r.data_reuniao
                    ? new Date(r.data_reuniao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
                    : '?';
                const tipo = r.status_atendimento === 'reuniao_fechamento' ? '🔴 Fechamento' : '📅 Atendimento';
                return `${i + 1}. *${r.nome_completo || r.telefone}* — ${hora} (${tipo})`;
            });

            const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
            const msg =
                `📋 *Confirmação de Reuniões — ${horaAtual}*\n\n` +
                `${linhas.join('\n')}\n\n` +
                `Acesse o painel para atualizar o status de cada lead:\n` +
                `• *Cliente fechou* → marque como "cliente"\n` +
                `• *Não apareceu / não fechou* → marque situação e adicione observação\n\n` +
                `_Este lembrete é enviado automaticamente 4x ao dia enquanto houver reuniões pendentes._`;

            await enqueueMessages({
                phone: attendantPhone,
                messages: [{ content: msg, type: 'text', delay: 0 }],
                context: 'cron-pos-reuniao'
            });

            log.info(`Notificação pós-reunião enviada — ${res.rows.length} reuniões pendentes`);

        } catch (error) {
            log.error('Erro no cron pós-reunião:', error);
        } finally {
            client.release();
        }
    });

    // ============================
    // 8. Red-Flag 24h — A cada hora
    //    Detecta leads que receberam o tutorial e-CAC há mais de 24h
    //    e ainda não confirmaram a procuração → marca red_flag + notifica Haylander
    // ============================
    cron.schedule('0 * * * *', async () => {
        const log = cronLogger.withTrace(`cron-redflag24-${Date.now().toString(36)}`);

        const client = await pool.connect();
        try {
            const res = await client.query(`
                SELECT
                    l.id, l.telefone, l.nome_completo,
                    l.cnpj
                FROM leads l
                JOIN leads_processo lp ON l.id = lp.lead_id
                WHERE l.situacao NOT IN ('red_flag', 'cliente', 'desqualificado', 'nutricao')
                  AND COALESCE(lp.procuracao_ativa, false) = false
                  AND COALESCE(lp.procuracao, false) = false
                  AND lp.recursos_entregues ? 'video-tutorial:video-tutorial-procuracao-ecac'
                  AND (lp.recursos_entregues->'video-tutorial:video-tutorial-procuracao-ecac'->>'delivered_at')::timestamptz
                      < NOW() - INTERVAL '24 hours'
            `);

            if (res.rows.length === 0) return;

            const attendantPhone = process.env.ATTENDANT_PHONE;
            let flagged = 0;

            for (const lead of res.rows) {
                const phone = lead.telefone as string;
                const redisKey = `redflag24_notified:${lead.id}`;
                if (await redis.get(redisKey)) continue; // já notificado

                await client.query(
                    `UPDATE leads SET situacao = 'red_flag', atualizado_em = NOW() WHERE id = $1`,
                    [lead.id]
                );
                await client.query(`
                    INSERT INTO leads_processo (lead_id, status_atendimento, updated_at)
                    VALUES ($1, 'aguardando_procuracao', NOW())
                    ON CONFLICT (lead_id) DO UPDATE
                        SET status_atendimento = 'aguardando_procuracao', updated_at = NOW()
                `, [lead.id]);

                await redis.set(redisKey, '1', 'EX', 60 * 60 * 24 * 7); // TTL 7 dias

                if (attendantPhone) {
                    const nome = lead.nome_completo || phone;
                    const cnpj = lead.cnpj ? ` (CNPJ ${lead.cnpj})` : '';
                    await enqueueMessages({
                        phone: attendantPhone,
                        messages: [{
                            content: `🔴 *RED FLAG — 24h sem procuração*\n\nLead: *${nome}*${cnpj}\nTelefone: ${phone}\n\nO tutorial e-CAC foi enviado há mais de 24h e o cliente ainda não concluiu a procuração. Sugestão: entrar em contato manualmente para entender a dificuldade.`,
                            type: 'text',
                            delay: 0,
                        }],
                        context: 'cron-redflag24',
                    });
                }

                log.info(`Red-flag 24h aplicado: ${phone} (lead ${lead.id})`);
                flagged++;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (flagged > 0) log.info(`${flagged} lead(s) marcados como red_flag por 24h sem procuração`);
        } catch (err) {
            log.error('Erro no cron red-flag 24h:', err);
        } finally {
            client.release();
        }
    });

    cronLogger.info('✅ Todos os jobs registrados');
}
