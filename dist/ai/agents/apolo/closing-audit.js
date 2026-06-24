"use strict";
/**
 * Auditoria do "formulário invisível" — decide se o cadastro do lead está completo
 * o suficiente para gerar a ata de fechamento e entregar o lead pronto para faturar.
 *
 * Módulo puro (sem DB/Redis/IO) para ser testável isoladamente.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditarCadastroCompleto = auditarCadastroCompleto;
const presente = (v) => v !== null && v !== undefined && String(v).trim() !== '';
function auditarCadastroCompleto(lead, precisaSenhaGov) {
    const faltando = [];
    if (!presente(lead.nome_completo) && !presente(lead.razao_social)) {
        faltando.push('Nome/Razão Social (nome_completo)');
    }
    if (!presente(lead.cnpj))
        faltando.push('CNPJ');
    if (!presente(lead.cpf))
        faltando.push('CPF');
    if (!presente(lead.email))
        faltando.push('E-mail (email)');
    if (precisaSenhaGov && !presente(lead.senha_gov_enc)) {
        faltando.push('Senha GOV (senha_gov)');
    }
    return { completo: faltando.length === 0, faltando };
}
//# sourceMappingURL=closing-audit.js.map