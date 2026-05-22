/**
 * Serviço de consulta de CNPJ com integração a APIs públicas
 * Implementa cache, rate limiting e tratamento de erros
 */
import { CNPJValidator } from './cnpj-validator';
export interface CNPJData {
    cnpj: string;
    razao_social: string;
    nome_fantasia?: string;
    situacao_cadastral: string;
    data_situacao_cadastral?: string;
    motivo_situacao_cadastral?: string;
    endereco: {
        logradouro: string;
        numero?: string;
        complemento?: string;
        bairro: string;
        municipio: string;
        uf: string;
        cep: string;
    };
    atividades_principais: Array<{
        code: string;
        text: string;
    }>;
    atividades_secundarias: Array<{
        code: string;
        text: string;
    }>;
    telefone?: string;
    email?: string;
    data_abertura?: string;
    capital_social?: number;
    porte?: string;
    natureza_juridica?: string;
    qsa?: Array<{
        nome: string;
        qualificacao: string;
    }>;
}
export interface CNPJQueryResult {
    success: boolean;
    data?: CNPJData;
    error?: {
        code: string;
        message: string;
        details?: any;
    };
    cached?: boolean;
    api_source?: string;
    timestamp: string;
}
export declare class CNPJService {
    private cache;
    private rateLimiter;
    private readonly timeout;
    /**
     * Consulta CNPJ usando APIs públicas com fallback
     */
    consultarCNPJ(cnpj: string, clientIp?: string): Promise<CNPJQueryResult>;
    /**
     * Consulta usando BrasilAPI
     */
    private consultarBrasilAPI;
    /**
     * Mapeia dados da BrasilAPI para nosso formato
     */
    private mapBrasilAPIData;
    /**
     * Consulta múltiplos CNPJs em lote
     */
    consultarLote(cnpjs: string[], clientIp?: string): Promise<Array<CNPJQueryResult>>;
    /**
     * Estatísticas do cache
     */
    getCacheStats(): {
        size: number;
        hitRate?: number;
    };
    /**
     * Limpa o cache
     */
    clearCache(): void;
}
export declare const cnpjService: CNPJService;
export { CNPJValidator };
//# sourceMappingURL=cnpj-service.d.ts.map