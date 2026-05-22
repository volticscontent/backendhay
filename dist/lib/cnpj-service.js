"use strict";
/**
 * Serviço de consulta de CNPJ com integração a APIs públicas
 * Implementa cache, rate limiting e tratamento de erros
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CNPJValidator = exports.cnpjService = exports.CNPJService = void 0;
const axios_1 = __importDefault(require("axios"));
const cnpj_validator_1 = require("./cnpj-validator");
Object.defineProperty(exports, "CNPJValidator", { enumerable: true, get: function () { return cnpj_validator_1.CNPJValidator; } });
const logger_1 = require("./logger");
// Cache simples em memória (pode ser substituído por Redis)
class CNPJCache {
    cache = new Map();
    TTL = 24 * 60 * 60 * 1000; // 24 horas
    get(cnpj) {
        const cached = this.cache.get(cnpj);
        if (!cached)
            return null;
        const now = Date.now();
        if (now - cached.timestamp > this.TTL) {
            this.cache.delete(cnpj);
            return null;
        }
        return cached.data;
    }
    set(cnpj, data) {
        this.cache.set(cnpj, {
            data,
            timestamp: Date.now()
        });
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
// Rate limiter simples (pode ser substituído por Redis)
class RateLimiter {
    requests = new Map();
    windowMs = 60 * 1000; // 1 minuto
    maxRequests = 10; // 10 requisições por minuto
    isAllowed(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        let userRequests = this.requests.get(key) || [];
        userRequests = userRequests.filter(timestamp => timestamp > windowStart);
        if (userRequests.length >= this.maxRequests) {
            return false;
        }
        userRequests.push(now);
        this.requests.set(key, userRequests);
        return true;
    }
}
class CNPJService {
    cache = new CNPJCache();
    rateLimiter = new RateLimiter();
    timeout = 10000; // 10 segundos
    /**
     * Consulta CNPJ usando APIs públicas com fallback
     */
    async consultarCNPJ(cnpj, clientIp) {
        const timestamp = new Date().toISOString();
        const cleanedCNPJ = cnpj_validator_1.CNPJValidator.clean(cnpj);
        // Validação inicial
        if (!cnpj_validator_1.CNPJValidator.isValid(cnpj)) {
            return {
                success: false,
                error: {
                    code: 'INVALID_CNPJ',
                    message: cnpj_validator_1.CNPJValidator.getErrorMessage(cnpj)
                },
                timestamp
            };
        }
        // Rate limiting
        if (clientIp && !this.rateLimiter.isAllowed(clientIp)) {
            return {
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Limite de requisições excedido. Tente novamente em 1 minuto.'
                },
                timestamp
            };
        }
        // Verifica cache
        const cachedData = this.cache.get(cleanedCNPJ);
        if (cachedData) {
            logger_1.bootLogger.info(`CNPJ ${cleanedCNPJ} encontrado em cache`);
            return {
                success: true,
                data: cachedData,
                cached: true,
                api_source: 'cache',
                timestamp
            };
        }
        try {
            // Tenta BrasilAPI primeiro (mais confiável)
            const result = await this.consultarBrasilAPI(cleanedCNPJ);
            // Armazena em cache
            if (result.success && result.data) {
                this.cache.set(cleanedCNPJ, result.data);
                logger_1.bootLogger.info(`CNPJ ${cleanedCNPJ} consultado com sucesso via BrasilAPI`);
            }
            // Garante que o campo cached seja sempre definido
            return {
                ...result,
                cached: false
            };
        }
        catch (error) {
            logger_1.bootLogger.error(`Erro ao consultar CNPJ ${cleanedCNPJ}:`, error);
            return {
                success: false,
                error: {
                    code: 'API_ERROR',
                    message: 'Erro ao consultar CNPJ. Tente novamente mais tarde.',
                    details: error instanceof Error ? error.message : 'Erro desconhecido'
                },
                timestamp
            };
        }
    }
    /**
     * Consulta usando BrasilAPI
     */
    async consultarBrasilAPI(cnpj) {
        const timestamp = new Date().toISOString();
        try {
            const response = await axios_1.default.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Haylander-Bot-Backend/1.0.0'
                }
            });
            const data = this.mapBrasilAPIData(response.data);
            return {
                success: true,
                data,
                api_source: 'brasilapi',
                timestamp
            };
        }
        catch (error) {
            // Verifica se é um erro do axios
            const axiosError = error;
            if (axiosError.response?.status === 404) {
                return {
                    success: false,
                    error: {
                        code: 'CNPJ_NOT_FOUND',
                        message: 'CNPJ não encontrado na base de dados'
                    },
                    timestamp
                };
            }
            if (axiosError.code === 'ECONNABORTED') {
                return {
                    success: false,
                    error: {
                        code: 'TIMEOUT',
                        message: 'Timeout na consulta. Tente novamente.'
                    },
                    timestamp
                };
            }
            throw error;
        }
    }
    /**
     * Mapeia dados da BrasilAPI para nosso formato
     */
    mapBrasilAPIData(apiData) {
        return {
            cnpj: apiData.cnpj,
            razao_social: apiData.razao_social,
            nome_fantasia: apiData.nome_fantasia || undefined,
            situacao_cadastral: apiData.descricao_situacao_cadastral,
            data_situacao_cadastral: apiData.data_situacao_cadastral,
            motivo_situacao_cadastral: apiData.descricao_motivo_situacao_cadastral,
            endereco: {
                logradouro: apiData.logradouro,
                numero: apiData.numero,
                complemento: apiData.complemento || undefined,
                bairro: apiData.bairro,
                municipio: apiData.municipio,
                uf: apiData.uf,
                cep: apiData.cep
            },
            atividades_principais: [{
                    code: apiData.cnae_fiscal,
                    text: apiData.cnae_fiscal_descricao
                }].filter(item => item.code && item.text),
            atividades_secundarias: (apiData.cnae_fiscal_secundaria || []).map((cnae) => ({
                code: cnae.codigo,
                text: cnae.descricao
            })).filter((item) => item.code && item.text),
            telefone: apiData.ddd_telefone_1 || undefined,
            email: apiData.email || undefined,
            data_abertura: apiData.data_inicio_atividade,
            capital_social: apiData.capital_social ? parseFloat(apiData.capital_social) : undefined,
            porte: apiData.descricao_porte,
            natureza_juridica: apiData.natureza_juridica,
            qsa: (apiData.qsa || []).map((socio) => ({
                nome: socio.nome_socio,
                qualificacao: socio.qualificacao_socio
            })).filter((item) => item.nome && item.qualificacao)
        };
    }
    /**
     * Consulta múltiplos CNPJs em lote
     */
    async consultarLote(cnpjs, clientIp) {
        const results = [];
        // Processa em paralelo com limite de concorrência
        const batchSize = 5;
        for (let i = 0; i < cnpjs.length; i += batchSize) {
            const batch = cnpjs.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(cnpj => this.consultarCNPJ(cnpj, clientIp)));
            results.push(...batchResults);
            // Pequeno delay entre lotes para não sobrecarregar as APIs
            if (i + batchSize < cnpjs.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return results;
    }
    /**
     * Estatísticas do cache
     */
    getCacheStats() {
        return {
            size: this.cache.size()
        };
    }
    /**
     * Limpa o cache
     */
    clearCache() {
        this.cache.clear();
        logger_1.bootLogger.info('Cache de CNPJ limpo');
    }
}
exports.CNPJService = CNPJService;
// Exporta instância singleton
exports.cnpjService = new CNPJService();
//# sourceMappingURL=cnpj-service.js.map