import { evolutionGetConnectionState } from './evolution';
import { cronLogger } from './logger';

let interval: NodeJS.Timeout | null = null;
let activeCount = 0;

/**
 * Inicia o Keep-alive de alta frequência (4 segundos).
 * Incrementa um contador de uso para evitar paradas prematuras se houver
 * múltiplas mensagens sendo processadas.
 */
export function startHighFrequencyPoke() {
    activeCount++;
    if (interval) {
        cronLogger.debug(`[Poker] Já está ativo. Count: ${activeCount}`);
        return;
    }

    cronLogger.info(`🔥 [Poker] Iniciando High-Frequency Keep-alive (4s). activeCount: ${activeCount}`);
    interval = setInterval(async () => {
        try {
            const state: any = await evolutionGetConnectionState();
            const status = state?.instance?.state || state?.state || state?.status;
            cronLogger.debug(`[Poker] Poke 4s executado. Status: ${status}`);
        } catch (err) {
            cronLogger.error('[Poker] Erro no poke 4s:', err);
        }
    }, 4000);
}

/**
 * Para o Keep-alive de alta frequência (4 segundos).
 * Decrementa o contador e limpa o intervalo se chegar a zero.
 */
export function stopHighFrequencyPoke() {
    if (activeCount > 0) activeCount--;
    
    if (activeCount === 0 && interval) {
        cronLogger.info('🛑 [Poker] Parando High-Frequency Keep-alive (count 0).');
        clearInterval(interval);
        interval = null;
    } else {
        cronLogger.debug(`[Poker] Stop solicitado, mas permanece ativo. Count: ${activeCount}`);
    }
}
