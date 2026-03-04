import cron from 'node-cron';
import pool from '../lib/db';
import redis from '../lib/redis';
import { enqueueMessages } from '../queues/message-queue';
import { cronLogger } from '../lib/logger';

/**
 * Registra todos os CRON jobs do sistema
 */
export function registerCronJobs(): void {
    cronLogger.info('Registrando jobs...');

    // ============================
    // 1. Context Sync — A cada 10 minutos
    //    Processa usuários inativos há 10+ minutos e sincroniza contexto
    // ============================
    cron.schedule('*/10 * * * *', async () => {
        cronLogger.debug('Context Sync - Iniciando...');
        try {
            const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutos atrás
            const users = await redis.zrangebyscore('context_sync_queue', 0, cutoff);

            if (users.length === 0) return;

            cronLogger.info(`Context Sync - ${users.length} usuários para processar`);

            for (const phone of users) {
                try {
                    // Opcional: enviar nudge de 5 minutos se não enviou
                    const nudgeSent = await redis.get(`context_nudge_sent:${phone}`);
                    if (!nudgeSent) {
                        // Marcar como processado e remover da fila
                        await redis.zrem('context_sync_queue', phone);
                        cronLogger.debug(`Context Sync - ${phone} processado`);
                    }
                } catch (err) {
                    cronLogger.error(`Erro ao processar ${phone}:`, err);
                }
            }
        } catch (error) {
            cronLogger.error('Context Sync Error:', error);
        }
    });

    // ============================
    // 2. Follow-up de Inatividade — A cada 30 minutos
    //    Envia lembrete para leads que não responderam há mais de 2 horas
    // ============================
    cron.schedule('*/30 * * * *', async () => {
        cronLogger.info('Follow-up Inatividade - Iniciando...');
        const client = await pool.connect();
        try {
            // Buscar leads "nao_respondido" há mais de 2 horas sem follow-up recente
            const res = await client.query(`
        SELECT l.telefone, l.nome_completo
        FROM leads l
        LEFT JOIN leads_atendimento la ON l.id = la.lead_id
        WHERE l.situacao = 'nao_respondido'
          AND l.data_cadastro < NOW() - INTERVAL '2 hours'
          AND (la.data_followup IS NULL OR la.data_followup < NOW() - INTERVAL '24 hours')
        LIMIT 10
      `);

            if (res.rows.length === 0) return;
            cronLogger.info(`Follow-up - ${res.rows.length} leads para contatar`);

            for (const lead of res.rows) {
                try {
                    // Limpar telefone: remover @lid, @s.whatsapp.net etc
                    const rawPhone = lead.telefone || '';
                    const phone = rawPhone.split('@')[0].replace(/\D/g, '');

                    if (!phone || phone.length < 10) {
                        cronLogger.debug(`Follow-up - Telefone inválido, pulando: ${rawPhone}`);
                        continue;
                    }

                    const nome = lead.nome_completo || 'Cliente';

                    await enqueueMessages({
                        phone,
                        messages: [{ content: `Olá ${nome}! 😊 Vi que você se interessou pelos nossos serviços. Posso te ajudar com alguma dúvida?`, type: 'text', delay: 0 }],
                        context: 'cron-follow-up'
                    });

                    // Atualizar data de follow-up
                    await client.query(`
            UPDATE leads_atendimento SET data_followup = NOW()
            WHERE lead_id = (SELECT id FROM leads WHERE telefone = $1)
          `, [lead.telefone]);

                    cronLogger.info(`Follow-up enviado para ${phone}`);

                    // Rate limit: esperar 2s entre envios
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (err) {
                    cronLogger.error(`Erro no follow-up de ${lead.telefone}:`, err);
                }
            }
        } catch (error) {
            cronLogger.error('Follow-up Error:', error);
        } finally {
            client.release();
        }
    });

    // ============================
    // 3. Limpeza de Cache Redis — Diariamente às 3:00 AM
    // ============================
    cron.schedule('0 3 * * *', async () => {
        cronLogger.info('Limpeza de cache - Iniciando...');
        try {
            // Limpar filas de contexto antigas (mais de 24h)
            const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
            const removed = await redis.zremrangebyscore('context_sync_queue', 0, cutoff24h);
            cronLogger.info(`Limpeza - ${removed} entradas de contexto removidas`);
        } catch (error) {
            cronLogger.error('Limpeza Error:', error);
        }
    });

    // ============================
    // 4. Relatório Diário — Às 8:00 AM
    //    Envia resumo de atividade para o atendente
    // ============================
    cron.schedule('0 8 * * *', async () => {
        cronLogger.info('Relatório Diário - Gerando...');
        const client = await pool.connect();
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const [newLeads, qualifiedLeads, meetings] = await Promise.all([
                client.query(`SELECT COUNT(*) as count FROM leads WHERE data_cadastro > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads WHERE situacao = 'qualificado' AND data_cadastro > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads_vendas WHERE data_reuniao > $1`, [yesterday]),
            ]);

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
                cronLogger.info('Relatório enviado para a fila');
            }
        } catch (error) {
            cronLogger.error('Relatório Error:', error);
        } finally {
            client.release();
        }
    });

    cronLogger.info('✅ Todos os jobs registrados');
}
