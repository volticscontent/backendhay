/**
 * Inicia o Keep-alive de alta frequência (4 segundos).
 * Incrementa um contador de uso para evitar paradas prematuras se houver
 * múltiplas mensagens sendo processadas.
 */
export declare function startHighFrequencyPoke(): void;
/**
 * Para o Keep-alive de alta frequência (4 segundos).
 * Decrementa o contador e limpa o intervalo se chegar a zero.
 */
export declare function stopHighFrequencyPoke(): void;
//# sourceMappingURL=poker.d.ts.map