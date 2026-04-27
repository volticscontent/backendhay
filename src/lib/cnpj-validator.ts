/**
 * Serviço de validação e formatação de CNPJ
 * Implementa algoritmo de dígitos verificadores
 */

export class CNPJValidator {
  /**
   * Remove máscaras e caracteres especiais do CNPJ
   */
  static clean(cnpj: string): string {
    return cnpj.replace(/[^\d]/g, '');
  }

  /**
   * Verifica se o CNPJ tem formato válido (14 dígitos)
   */
  static isValidFormat(cnpj: string): boolean {
    const cleaned = this.clean(cnpj);
    return /^\d{14}$/.test(cleaned);
  }

  /**
   * Valida dígitos verificadores do CNPJ
   */
  static isValidCheckDigits(cnpj: string): boolean {
    const cleaned = this.clean(cnpj);
    
    if (!this.isValidFormat(cleaned)) {
      return false;
    }

    // Verifica se todos os dígitos são iguais (CNPJ inválido)
    if (/^(\d)\1{13}$/.test(cleaned)) {
      return false;
    }

    // Calcula primeiro dígito verificador
    const firstCheckDigit = this.calculateCheckDigit(cleaned.slice(0, 12));
    
    // Calcula segundo dígito verificador
    const secondCheckDigit = this.calculateCheckDigit(cleaned.slice(0, 13));

    return cleaned[12] === firstCheckDigit && cleaned[13] === secondCheckDigit;
  }

  /**
   * Calcula dígito verificador
   */
  private static calculateCheckDigit(digits: string): string {
    const weights = digits.length === 12 
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      sum += parseInt(digits[i]) * weights[i];
    }

    const remainder = sum % 11;
    return remainder < 2 ? '0' : (11 - remainder).toString();
  }

  /**
   * Valida CNPJ completo (formato e dígitos verificadores)
   */
  static isValid(cnpj: string): boolean {
    if (!cnpj) return false;
    return this.isValidCheckDigits(cnpj);
  }

  /**
   * Formata CNPJ com máscara (XX.XXX.XXX/XXXX-XX)
   */
  static format(cnpj: string): string {
    const cleaned = this.clean(cnpj);
    
    if (!this.isValidFormat(cleaned)) {
      return cnpj;
    }

    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  /**
   * Remove formatação e retorna apenas números
   */
  static unformat(cnpj: string): string {
    return this.clean(cnpj);
  }

  /**
   * Retorna mensagem de erro detalhada para CNPJ inválido
   */
  static getErrorMessage(cnpj: string): string {
    if (!cnpj || !cnpj.trim()) {
      return 'CNPJ é obrigatório';
    }

    const cleaned = this.clean(cnpj);

    if (!/^\d{14}$/.test(cleaned)) {
      return 'CNPJ deve conter 14 dígitos numéricos';
    }

    if (/^(\d)\1{13}$/.test(cleaned)) {
      return 'CNPJ com dígitos repetidos é inválido';
    }

    return 'CNPJ inválido - dígitos verificadores incorretos';
  }
}