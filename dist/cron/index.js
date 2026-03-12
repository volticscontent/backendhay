"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCronJobs = registerCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = __importDefault(require("../lib/db"));
const message_queue_1 = require("../queues/message-queue");
const logger_1 = require("../lib/logger");
const business_hours_1 = require("../lib/business-hours");
/**
 * Registra todos os CRON jobs do sistema
 */
function registerCronJobs() {
    logger_1.cronLogger.info('Registrando jobs...');
    // ============================
    // 1. Context Sync — REMOVIDO
    //    Nudges de inatividade agora são gerenciados pelo BullMQ follow-up queue
    //    (scheduleFollowUp em message-debounce.ts) com timer de 5 minutos.
    // ============================
    // ============================
    // 2. Follow-up de Inatividade — A cada 30 minutos
    //    Envia lembrete para leads que não responderam há mais de 2 horas
    // ============================
    // ============================
    // 2. Follow-up de Inatividade — A cada 30 minutos
    //    Envia lembrete para leads que não responderam há mais de 2 horas
    // ============================
    node_cron_1.default.schedule('*/30 * * * *', async () => {
        const log = logger_1.cronLogger.withTrace(`cron-followup-${Date.now().toString(36)}`);
        if (!(0, business_hours_1.isWithinBusinessHours)()) {
            log.debug('Follow-up Inatividade - Fora do horário comercial, pulando.');
            return;
        }
        log.info('Follow-up Inatividade - Iniciando...');
        const timer = log.timer('Cron Follow-up Total');
        const client = await db_1.default.connect();
        try {
            // Buscar leads "nao_respondido" há mais de 2 horas sem follow-up recente
            const res = await log.timed('Query leads inativos', () => client.query(`
        SELECT l.telefone, l.nome_completo
        FROM leads l
        LEFT JOIN leads_atendimento la ON l.id = la.lead_id
        WHERE l.situacao = 'nao_respondido'
          AND l.data_cadastro < NOW() - INTERVAL '2 hours'
          AND (la.data_followup IS NULL OR la.data_followup < NOW() - INTERVAL '24 hours')
        LIMIT 10
      `));
            if (res.rows.length === 0) {
                log.info('Nenhum lead para follow-up no momento.');
                timer.end('Sem leads');
                return;
            }
            log.info(`Follow-up - ${res.rows.length} leads para contatar`);
            let count = 0;
            for (const lead of res.rows) {
                try {
                    // Limpar telefone: remover @lid, @s.whatsapp.net etc
                    const rawPhone = lead.telefone || '';
                    const phone = rawPhone.split('@')[0].replace(/\D/g, '');
                    if (!phone || phone.length < 10) {
                        log.debug(`Follow-up - Telefone inválido, pulando: ${rawPhone}`);
                        continue;
                    }
                    const nome = lead.nome_completo || 'Cliente';
                    await (0, message_queue_1.enqueueMessages)({
                        phone,
                        messages: [{ content: `Olá ${nome}! 😊 Vi que você se interessou pelos nossos serviços. Posso te ajudar com alguma dúvida?`, type: 'text', delay: 0 }],
                        context: 'cron-follow-up'
                    });
                    // Atualizar data de follow-up
                    await client.query(`
            UPDATE leads_atendimento SET data_followup = NOW()
            WHERE lead_id = (SELECT id FROM leads WHERE telefone = $1)
          `, [lead.telefone]);
                    log.info(`Follow-up enviado para ${phone}`);
                    count++;
                    // Rate limit: esperar 2s entre envios
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                catch (err) {
                    log.error(`Erro no follow-up de ${lead.telefone}:`, err);
                }
            }
            timer.end(`${count} follow-ups enviados`);
        }
        catch (error) {
            log.error('Follow-up Error:', error);
            timer.end('Erro');
        }
        finally {
            client.release();
        }
    });
    // ============================
    // 3. Limpeza de Cache Redis — Diariamente às 3:00 AM
    // ============================
    node_cron_1.default.schedule('0 3 * * *', async () => {
        const log = logger_1.cronLogger.withTrace(`cron-clean-${Date.now().toString(36)}`);
        log.info('Limpeza noturna - Iniciando...');
        const timer = log.timer('Limpeza Noturna');
        try {
            // Limpar histórico de chat antigo (> 7 dias)
            const result = await db_1.default.query(`DELETE FROM chat_history WHERE created_at < NOW() - INTERVAL '7 days'`);
            log.info(`Limpeza - ${result.rowCount} mensagens de chat removidas`);
            timer.end(`${result.rowCount} msg removidas`);
        }
        catch (error) {
            log.error('Limpeza Error:', error);
            timer.end('Erro na limpeza');
        }
    });
    // ============================
    // 4. Relatório Diário — Às 8:00 AM
    //    Envia resumo de atividade para o atendente
    // ============================
    node_cron_1.default.schedule('0 8 * * *', async () => {
        const log = logger_1.cronLogger.withTrace(`cron-report-${Date.now().toString(36)}`);
        log.info('Relatório Diário - Gerando...');
        const timer = log.timer('Relatório Diário Total');
        const client = await db_1.default.connect();
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const [newLeads, qualifiedLeads, meetings] = await log.timed('Monitoramento de leads e reuniões', () => Promise.all([
                client.query(`SELECT COUNT(*) as count FROM leads WHERE data_cadastro > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads WHERE situacao = 'qualificado' AND data_cadastro > $1`, [yesterday]),
                client.query(`SELECT COUNT(*) as count FROM leads_vendas WHERE data_reuniao > $1`, [yesterday]),
            ]));
            const report = `📊 *Relatório Diário Haylander*\n\n` +
                `📥 Novos Leads: ${newLeads.rows[0].count}\n` +
                `✅ Qualificados: ${qualifiedLeads.rows[0].count}\n` +
                `📅 Reuniões Agendadas: ${meetings.rows[0].count}\n` +
                `📆 Data: ${new Date().toLocaleDateString('pt-BR')}`;
            const attendantPhone = process.env.ATTENDANT_PHONE;
            if (attendantPhone) {
                await (0, message_queue_1.enqueueMessages)({
                    phone: attendantPhone,
                    messages: [{ content: report, type: 'text', delay: 0 }],
                    context: 'cron-relatorio-diario'
                });
                log.info('Relatório enviado para a fila');
                timer.end('Relatório enviado');
            }
            else {
                log.warn('Relatório não enviado: ATTENDANT_PHONE ausente no .env');
                timer.end('Sem ATTENDANT_PHONE');
            }
        }
        catch (error) {
            log.error('Relatório Error:', error);
            timer.end('Erro no relatório');
        }
        finally {
            client.release();
        }
    });
    logger_1.cronLogger.info('✅ Todos os jobs registrados');
}
//# sourceMappingURL=index.js.map