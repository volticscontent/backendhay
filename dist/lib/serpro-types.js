"use strict";
/**
 * Tipos e DTOs da API Serpro Integra Contador.
 * Referência: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoContribuinte = void 0;
// ─── Enums ────────────────────────────────────────────────────────────────────
/** Tipo numérico do contribuinte/contratante conforme especificação Serpro. */
var TipoContribuinte;
(function (TipoContribuinte) {
    TipoContribuinte[TipoContribuinte["CPF"] = 1] = "CPF";
    TipoContribuinte[TipoContribuinte["CNPJ"] = 2] = "CNPJ";
    TipoContribuinte[TipoContribuinte["LISTA_PF"] = 3] = "LISTA_PF";
    TipoContribuinte[TipoContribuinte["LISTA_PJ"] = 4] = "LISTA_PJ";
})(TipoContribuinte || (exports.TipoContribuinte = TipoContribuinte = {}));
//# sourceMappingURL=serpro-types.js.map