import https from 'node:https';
import { SERVICE_CONFIG } from './serpro-config';
export { SERVICE_CONFIG };
interface SerproTokens {
    access_token: string;
    jwt_token: string;
}
export declare function request(urlStr: string, options: https.RequestOptions, body?: string): Promise<unknown>;
export declare function getSerproTokens(): Promise<SerproTokens>;
export interface SerproOptions {
    ano?: string;
    mes?: string;
    numeroRecibo?: string;
    codigoReceita?: string;
    categoria?: string;
}
export declare function consultarServico(nomeServico: keyof typeof SERVICE_CONFIG, cnpj: string, options?: SerproOptions): Promise<unknown>;
//# sourceMappingURL=serpro.d.ts.map