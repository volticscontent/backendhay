/**
 * Auditoria do "formulário invisível" — decide se o cadastro do lead está completo
 * o suficiente para gerar a ata de fechamento e entregar o lead pronto para faturar.
 *
 * Módulo puro (sem DB/Redis/IO) para ser testável isoladamente.
 */

/**
 * Lista canônica de campos obrigatórios para fechar o cadastro.
 * `telefone` é sempre conhecido (é a chave do lead), por isso não entra na auditoria.
 * `senha_gov` só é exigida na Opção B (atendimento humano sem procuração e-CAC).
 */
export type LeadParaFechamento = {
    nome_completo?: unknown;
    razao_social?: unknown;
    cnpj?: unknown;
    cpf?: unknown;
    email?: unknown;
    senha_gov_enc?: unknown;
};

const presente = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== '';

export function auditarCadastroCompleto(
    lead: LeadParaFechamento,
    precisaSenhaGov: boolean
): { completo: boolean; faltando: string[] } {
    const faltando: string[] = [];

    if (!presente(lead.nome_completo) && !presente(lead.razao_social)) {
        faltando.push('Nome/Razão Social (nome_completo)');
    }
    if (!presente(lead.cnpj)) faltando.push('CNPJ');
    if (!presente(lead.cpf)) faltando.push('CPF');
    if (!presente(lead.email)) faltando.push('E-mail (email)');
    if (precisaSenhaGov && !presente(lead.senha_gov_enc)) {
        faltando.push('Senha GOV (senha_gov)');
    }

    return { completo: faltando.length === 0, faltando };
}
