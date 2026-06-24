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
export declare function auditarCadastroCompleto(lead: LeadParaFechamento, precisaSenhaGov: boolean): {
    completo: boolean;
    faltando: string[];
};
//# sourceMappingURL=closing-audit.d.ts.map