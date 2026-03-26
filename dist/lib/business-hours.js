"use strict";
/**
 * Utilitário de Horário Comercial
 *
 * Horários da Haylander Martins Contabilidade (timezone: America/Sao_Paulo):
 * - Segunda a Quinta: 09:00 – 18:00
 * - Sexta: 09:00 – 17:00
 * - Sábado / Domingo: Fechado
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_HOURS_CONFIG = void 0;
exports.isWithinBusinessHours = isWithinBusinessHours;
exports.getNextAvailableSlot = getNextAvailableSlot;
exports.getOutOfHoursMessage = getOutOfHoursMessage;
exports.BUSINESS_HOURS_CONFIG = {
    timezone: 'America/Sao_Paulo',
    schedule: {
        0: null, // Domingo — fechado
        1: { open: 9, close: 18 }, // Segunda
        2: { open: 9, close: 18 }, // Terça
        3: { open: 9, close: 18 }, // Quarta
        4: { open: 9, close: 18 }, // Quinta
        5: { open: 9, close: 17 }, // Sexta
        6: null, // Sábado — fechado
    },
};
/**
 * Retorna a data/hora atual no fuso de São Paulo.
 */
function nowInSaoPaulo() {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: exports.BUSINESS_HOURS_CONFIG.timezone });
    return new Date(nowStr);
}
/**
 * Verifica se o momento atual está dentro do horário comercial.
 */
function isWithinBusinessHours() {
    const now = nowInSaoPaulo();
    const dayOfWeek = now.getDay();
    const hour = now.getHours();
    const daySchedule = exports.BUSINESS_HOURS_CONFIG.schedule[dayOfWeek];
    if (!daySchedule)
        return false; // Dia fechado
    return hour >= daySchedule.open && hour < daySchedule.close;
}
/**
 * Retorna a próxima data/hora disponível considerando um offset de minutos.
 * Respeita o horário comercial e pula fins de semana.
 */
function getNextAvailableSlot(baseDate, offsetMinutes) {
    // Fuso de São Paulo
    const nowStr = baseDate.toLocaleString('en-US', { timeZone: exports.BUSINESS_HOURS_CONFIG.timezone });
    let date = new Date(nowStr);
    // Adiciona o offset inicial
    date.setMinutes(date.getMinutes() + offsetMinutes);
    // Ajusta para o horário comercial
    let iterations = 0;
    while (iterations < 10) { // Safety break
        iterations++;
        const day = date.getDay();
        const hour = date.getHours();
        const schedule = exports.BUSINESS_HOURS_CONFIG.schedule[day];
        // 1. Se for dia fechado (fim de semana), pula para o próximo dia às 09:00
        if (!schedule) {
            date.setDate(date.getDate() + 1);
            date.setHours(9, 0, 0, 0);
            continue;
        }
        // 2. Se for antes do horário de abertura, ajusta para a abertura
        if (hour < schedule.open) {
            date.setHours(schedule.open, 0, 0, 0);
            return date;
        }
        // 3. Se for depois ou no limite do fechamento, pula para o próximo dia às 09:00
        if (hour >= schedule.close) {
            date.setDate(date.getDate() + 1);
            date.setHours(9, 0, 0, 0);
            continue;
        }
        // Se chegou aqui, está dentro do horário e é um dia válido
        return date;
    }
    return date;
}
/**
 * Retorna a mensagem padronizada para fora do horário.
 */
function getOutOfHoursMessage() {
    const now = nowInSaoPaulo();
    const dayOfWeek = now.getDay();
    // Se for fim de semana
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return (`Olá! 😊 Tudo bem?\n\n` +
            `Não estamos disponíveis no momento.\n\n` +
            `Nosso horário de atendimento é de 09h às 18h, de segunda à quinta, e 09h às 17h na sexta.\n\n` +
            `Se precisa regularizar o seu MEI, envia aqui o seu CNPJ que vamos analisar a sua situação e conversamos em breve.\n\n` +
            `Se for outra demanda, pode deixar aqui também que será respondida assim que possível. Obrigado pela compreensão! 🚀`);
    }
    // Dia útil mas fora do horário
    return (`Olá! 😊 Tudo bem?\n\n` +
        `Não estamos disponíveis no momento.\n\n` +
        `Nosso horário de atendimento é de 09h às 18h, de segunda à quinta, e 09h às 17h na sexta.\n\n` +
        `Se precisa regularizar o seu MEI, envia aqui o seu CNPJ que vamos analisar a sua situação e conversamos em breve.\n\n` +
        `Se for outra demanda, pode deixar aqui também que será respondida assim que possível. Obrigado pela compreensão! 🚀`);
}
//# sourceMappingURL=business-hours.js.map