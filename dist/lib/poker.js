"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startHighFrequencyPoke = startHighFrequencyPoke;
exports.stopHighFrequencyPoke = stopHighFrequencyPoke;
const evolution_1 = require("./evolution");
const logger_1 = require("./logger");
let interval = null;
let activeCount = 0;
/**
 * Inicia o Keep-alive de alta frequência (4 segundos).
 * Incrementa um contador de uso para evitar paradas prematuras se houver
 * múltiplas mensagens sendo processadas.
 */
function startHighFrequencyPoke() {
    activeCount++;
    if (interval) {
        logger_1.cronLogger.debug(`[Poker] Já está ativo. Count: ${activeCount}`);
        return;
    }
    logger_1.cronLogger.info(`🔥 [Poker] Iniciando High-Frequency Keep-alive (4s). activeCount: ${activeCount}`);
    interval = setInterval(async () => {
        try {
            const state = await (0, evolution_1.evolutionGetConnectionState)();
            const status = state?.instance?.state || state?.state || state?.status;
            logger_1.cronLogger.debug(`[Poker] Poke 4s executado. Status: ${status}`);
        }
        catch (err) {
            logger_1.cronLogger.error('[Poker] Erro no poke 4s:', err);
        }
    }, 4000);
}
/**
 * Para o Keep-alive de alta frequência (4 segundos).
 * Decrementa o contador e limpa o intervalo se chegar a zero.
 */
function stopHighFrequencyPoke() {
    if (activeCount > 0)
        activeCount--;
    if (activeCount === 0 && interval) {
        logger_1.cronLogger.info('🛑 [Poker] Parando High-Frequency Keep-alive (count 0).');
        clearInterval(interval);
        interval = null;
    }
    else {
        logger_1.cronLogger.debug(`[Poker] Stop solicitado, mas permanece ativo. Count: ${activeCount}`);
    }
}
//# sourceMappingURL=poker.js.map