/**
 * Utilitário de Horário Comercial
 * 
 * Horários da Haylander Contabilidade (timezone: America/Sao_Paulo):
 * - Segunda a Quinta: 09:00 – 18:00
 * - Sexta: 09:00 – 17:00
 * - Sábado / Domingo: Fechado
 */

export interface BusinessHoursConfig {
    timezone: string;
    schedule: Record<number, { open: number; close: number } | null>; // 0=domingo ... 6=sábado
}

export const BUSINESS_HOURS_CONFIG: BusinessHoursConfig = {
    timezone: 'America/Sao_Paulo',
    schedule: {
        0: null,                      // Domingo — fechado
        1: { open: 9, close: 18 },    // Segunda
        2: { open: 9, close: 18 },    // Terça
        3: { open: 9, close: 18 },    // Quarta
        4: { open: 9, close: 18 },    // Quinta
        5: { open: 9, close: 17 },    // Sexta
        6: null,                      // Sábado — fechado
    },
};

/**
 * Retorna a data/hora atual no fuso de São Paulo.
 */
function nowInSaoPaulo(): Date {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: BUSINESS_HOURS_CONFIG.timezone });
    return new Date(nowStr);
}

/**
 * Verifica se o momento atual está dentro do horário comercial.
 */
export function isWithinBusinessHours(): boolean {
    const now = nowInSaoPaulo();
    const dayOfWeek = now.getDay();
    const hour = now.getHours();

    const daySchedule = BUSINESS_HOURS_CONFIG.schedule[dayOfWeek];
    if (!daySchedule) return false; // Dia fechado

    return hour >= daySchedule.open && hour < daySchedule.close;
}

/**
 * Retorna a mensagem padronizada para fora do horário.
 */
export function getOutOfHoursMessage(): string {
    const now = nowInSaoPaulo();
    const dayOfWeek = now.getDay();

    // Se for fim de semana
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return (
            `Olá! 😊 Tudo bem?\n\n` +
            `Não estamos disponíveis no momento.\n\n` +
            `Nosso horário de atendimento é de 09h às 18h, de segunda à quinta, e 09h às 17h na sexta.\n\n` +
            `Se precisa regularizar o seu MEI, envia aqui o seu CNPJ que vamos analisar a sua situação e conversamos em breve.\n\n` +
            `Se for outra demanda, pode deixar aqui também que será respondida assim que possível. Obrigado pela compreensão! 🚀`
        );
    }

    // Dia útil mas fora do horário
    return (
        `Olá! 😊 Tudo bem?\n\n` +
        `Não estamos disponíveis no momento.\n\n` +
        `Nosso horário de atendimento é de 09h às 18h, de segunda à quinta, e 09h às 17h na sexta.\n\n` +
        `Se precisa regularizar o seu MEI, envia aqui o seu CNPJ que vamos analisar a sua situação e conversamos em breve.\n\n` +
        `Se for outra demanda, pode deixar aqui também que será respondida assim que possível. Obrigado pela compreensão! 🚀`
    );
}
