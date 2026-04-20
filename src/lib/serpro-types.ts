/**
 * Tipos e DTOs da API Serpro Integra Contador.
 * Referência: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Tipo numérico do contribuinte/contratante conforme especificação Serpro. */
export enum TipoContribuinte {
    CPF      = 1,
    CNPJ     = 2,
    LISTA_PF = 3, // consulta em lote de pessoas físicas
    LISTA_PJ = 4, // consulta em lote de pessoas jurídicas
}

// ─── Request ──────────────────────────────────────────────────────────────────

export interface SerproParte {
    numero: string;
    tipo: TipoContribuinte;
}

export interface SerproPedidoDados {
    idSistema: string;
    idServico: string;
    /** Versão do sistema conforme documentação oficial. A maioria dos serviços usa "1.0",
     *  mas alguns exigem versões específicas (ex: PGMEI/DIVIDA_ATIVA precisam "2.4",
     *  SITFIS precisa "2.0"). Configurar por serviço em serpro-config.ts. */
    versaoSistema: string;
    /** JSON serializado como string (com escape). Vazio ("") para serviços sem parâmetros. */
    dados: string;
}

export interface SerproPayload {
    contratante: SerproParte;
    autorPedidoDados: SerproParte;
    contribuinte: SerproParte;
    pedidoDados: SerproPedidoDados;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface SerproTokens {
    access_token: string;
    jwt_token: string;
    /** Timestamp em ms (Date.now()) em que o cache expira (meia-noite BRT). */
    expiresAt: number;
}

// ─── Options de chamada ───────────────────────────────────────────────────────

export interface SerproOptions {
    ano?: string;
    mes?: string;
    numeroRecibo?: string;
    codigoReceita?: string;
    categoria?: string;
    numeroDas?: string;
    parcelaParaEmitir?: string;
    /** Obrigatório para SIT_FISCAL_RELATORIO: protocolo retornado pelo SIT_FISCAL_SOLICITAR */
    protocoloRelatorio?: string;
    /** CPF do contribuinte (11 dígitos). Usado pelo SITFIS que consulta por CPF, não CNPJ. */
    cpf?: string;
}
