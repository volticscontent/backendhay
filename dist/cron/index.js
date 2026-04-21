"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCronJobs = registerCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = __importDefault(require("../lib/db"));
const redis_1 = __importDefault(require("../lib/redis"));
const message_queue_1 = require("../queues/message-queue");
const logger_1 = require("../lib/logger");
const business_hours_1 = require("../lib/business-hours");
const utils_1 = require("../lib/utils");
const evolution_1 = require("../lib/evolution");
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
        LEFT JOIN leads_processo lp ON l.id = lp.lead_id
        WHERE l.situacao = 'nao_respondido'
          AND l.data_cadastro < NOW() - INTERVAL '2 hours'
          AND (lp.data_followup IS NULL OR lp.data_followup < NOW() - INTERVAL '24 hours')
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
                    // Limpar telefone usando utilitário robusto
                    const phone = (0, utils_1.normalizePhone)(lead.telefone || '');
                    if (!phone || phone.length < 10) {
                        log.debug(`Follow-up - Telefone inválido, pulando: ${lead.telefone}`);
                        continue;
                    }
                    const nome = lead.nome_completo || 'Cliente';
                    await (0, message_queue_1.enqueueMessages)({
                        phone,
                        messages: [{ content: `Olá ${nome}! 😊 Vi que você se interessou pelos nossos serviços. Posso te ajudar com alguma dúvida?`, type: 'text', delay: 0 }],
                        context: 'cron-follow-up'
                    });
                    // Atualizar data de follow-up (cria o registro se não existir)
                    await client.query(`
            INSERT INTO leads_processo (lead_id, data_followup)
            VALUES ((SELECT id FROM leads WHERE telefone = $1 LIMIT 1), NOW())
            ON CONFLICT (lead_id) DO UPDATE SET data_followup = NOW(), updated_at = NOW()
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
    // ============================
    // 5. Evolution API Keep-Alive — A cada 2 minutos
    //    Mantém a instância sincronizada se estiver inativa há mais de 5 minutos
    // ============================
    node_cron_1.default.schedule('*/1 * * * *', async () => {
        const log = logger_1.cronLogger.withTrace(`cron-keepalive-${Date.now().toString(36)}`);
        try {
            const JANELA_MINIMA_MS = 2 * 60 * 1000; // 2 minutos de silêncio
            const lastActivity = await redis_1.default.get('evolution:last_activity');
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
            const state = await (0, evolution_1.evolutionGetConnectionState)();
            // Extrair status de forma robusta
            const connectionStatus = state?.instance?.state || state?.state || state?.status || state?.instance?.connectionStatus;
            log.info(`Estado da instância: ${connectionStatus || JSON.stringify(state)}`);
            if (connectionStatus !== 'open') {
                log.warn(`⚠️ Instância não está 'open' (status: ${connectionStatus}). Tentando reconectar...`);
                await (0, evolution_1.evolutionConnectInstance)();
                log.info('Chamada de reconexão enviada.');
            }
            else {
                log.info('✅ Instância saudável (open).');
            }
            // Atualizar atividade após o poke bem-sucedido
            await redis_1.default.set('evolution:last_activity', Date.now().toString());
        }
        catch (error) {
            log.error('Erro no Keep-alive:', error);
        }
    });
    logger_1.cronLogger.info('✅ Todos os jobs registrados');
}
//# sourceMappingURL=index.js.map