import https from 'node:https';
import { SERVICE_CONFIG } from './serpro-config';
import { SerproTokens, SerproOptions } from './serpro-types';
export { SERVICE_CONFIG };
export declare function request(urlStr: string, options: https.RequestOptions, body?: string, retries?: number): Promise<unknown>;
export declare function getSerproTokens(forceRefresh?: boolean): Promise<SerproTokens>;
export type { SerproOptions, SerproTokens, TipoContribuinte } from './serpro-types';
export declare function consultarServico(nomeServico: keyof typeof SERVICE_CONFIG, cnpj: string, options?: SerproOptions): Promise<unknown>;
//# sourceMappingURL=serpro.d.ts.map