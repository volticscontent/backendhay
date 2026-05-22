/**
 * Cria empresa em integra_empresas logo após procuração ser confirmada.
 * Usa dados já disponíveis em leads (cnpj, razao_social).
 * Idempotente via ON CONFLICT DO NOTHING.
 */
export declare function autoRegisterEmpresa(leadId: number): Promise<{
    empresaId: number | null;
    phone: string | null;
}>;
/**
 * Enriquece empresa recém-criada com regime e certificado inferidos via GPT-4o-mini.
 * Fire-and-forget: falha silenciosamente, nunca propaga exceção.
 */
export declare function enrichEmpresaFromChat(empresaId: number, phone: string): Promise<void>;
//# sourceMappingURL=empresa-auto-register.d.ts.map