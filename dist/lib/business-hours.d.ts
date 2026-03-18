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
    schedule: Record<number, {
        open: number;
        close: number;
    } | null>;
}
export declare const BUSINESS_HOURS_CONFIG: BusinessHoursConfig;
/**
 * Verifica se o momento atual está dentro do horário comercial.
 */
export declare function isWithinBusinessHours(): boolean;
/**
 * Retorna a próxima data/hora disponível considerando um offset de minutos.
 * Respeita o horário comercial e pula fins de semana.
 */
export declare function getNextAvailableSlot(baseDate: Date, offsetMinutes: number): Date;
/**
 * Retorna a mensagem padronizada para fora do horário.
 */
export declare function getOutOfHoursMessage(): string;
//# sourceMappingURL=business-hours.d.ts.map