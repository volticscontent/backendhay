/**
 * Serviço de validação e formatação de CNPJ
 * Implementa algoritmo de dígitos verificadores
 */
export declare class CNPJValidator {
    /**
     * Remove máscaras e caracteres especiais do CNPJ
     */
    static clean(cnpj: string): string;
    /**
     * Verifica se o CNPJ tem formato válido (14 dígitos)
     */
    static isValidFormat(cnpj: string): boolean;
    /**
     * Valida dígitos verificadores do CNPJ
     */
    static isValidCheckDigits(cnpj: string): boolean;
    /**
     * Calcula dígito verificador
     */
    private static calculateCheckDigit;
    /**
     * Valida CNPJ completo (formato e dígitos verificadores)
     */
    static isValid(cnpj: string): boolean;
    /**
     * Formata CNPJ com máscara (XX.XXX.XXX/XXXX-XX)
     */
    static format(cnpj: string): string;
    /**
     * Remove formatação e retorna apenas números
     */
    static unformat(cnpj: string): string;
    /**
     * Retorna mensagem de erro detalhada para CNPJ inválido
     */
    static getErrorMessage(cnpj: string): string;
}
//# sourceMappingURL=cnpj-validator.d.ts.map