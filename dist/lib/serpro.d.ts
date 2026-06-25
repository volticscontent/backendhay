import https from 'node:https';
import { SERVICE_CONFIG } from './serpro-config';
import { SerproTokens, SerproOptions } from './serpro-types';
export { SERVICE_CONFIG };
/**
 * Lê a data de expiração (notAfter) do certificado mTLS atualmente carregado.
 * Usado pelo cron de alerta de vencimento — quando o cert vence, TODA chamada
 * Serpro falha no handshake TLS de uma vez. Retorna null se não houver cert ou falhar o parse.
 */
export declare function getCertNotAfter(): Date | null;
export declare function request(urlStr: string, options: https.RequestOptions, body?: string, retries?: number): Promise<unknown>;
export declare function getSerproTokens(forceRefresh?: boolean): Promise<SerproTokens>;
export type { SerproOptions, SerproTokens, TipoContribuinte } from './serpro-types';
export declare function consultarServico(nomeServico: keyof typeof SERVICE_CONFIG, cnpj: string, options?: SerproOptions): Promise<unknown>;
//# sourceMappingURL=serpro.d.ts.map