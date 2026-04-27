/**
 * Testes unitários para CNPJValidator
 */

import { CNPJValidator } from '../cnpj-validator';

describe('CNPJValidator', () => {
  // CNPJs válidos para teste
  const validCNPJs = [
    '45.723.564/0001-90',
    '45.175.209/0001-24',
    '14.511.139/0001-04',
    '37.418.796/0001-07',
    '00000000000191', // Banco do Brasil
    '11222333000181'  // CNPJ de teste válido
  ];

  // CNPJs inválidos para teste
  const invalidCNPJs = [
    '00000000000000', // Todos dígitos iguais
    '11111111111111', // Todos dígitos iguais
    '12345678901234', // Dígitos verificadores inválidos
    '45.723.564/0001-91', // CNPJ válido com dígito errado
    '45.175.209/0001-25', // CNPJ válido com dígito errado
    '', // Vazio
    '123', // Muito curto
    'abcdefghijklmn', // Não numérico
    '45.723.564/0001-9', // incompleto
  ];

  describe('clean', () => {
    it('deve remover máscaras e caracteres especiais', () => {
      expect(CNPJValidator.clean('45.723.564/0001-90')).toBe('45723564000190');
      expect(CNPJValidator.clean('45.175.209/0001-24')).toBe('45175209000124');
      expect(CNPJValidator.clean('00000000000191')).toBe('00000000000191');
    });

    it('deve retornar string vazia para input vazio', () => {
      expect(CNPJValidator.clean('')).toBe('');
    });
  });

  describe('isValidFormat', () => {
    it('deve aceitar CNPJs com 14 dígitos', () => {
      expect(CNPJValidator.isValidFormat('45723564000190')).toBe(true);
      expect(CNPJValidator.isValidFormat('00000000000191')).toBe(true);
    });

    it('deve rejeitar CNPJs com formato inválido', () => {
      expect(CNPJValidator.isValidFormat('123')).toBe(false);
      expect(CNPJValidator.isValidFormat('abcdefghijklmn')).toBe(false);
      expect(CNPJValidator.isValidFormat('')).toBe(false);
      expect(CNPJValidator.isValidFormat('4572356400019')).toBe(false); // 13 dígitos
      expect(CNPJValidator.isValidFormat('457235640001900')).toBe(false); // 15 dígitos
    });
  });

  describe('isValidCheckDigits', () => {
    it('deve validar CNPJs com dígitos verificadores corretos', () => {
      validCNPJs.forEach(cnpj => {
        expect(CNPJValidator.isValidCheckDigits(cnpj)).toBe(true);
      });
    });

    it('deve rejeitar CNPJs com dígitos verificadores incorretos', () => {
      invalidCNPJs.forEach(cnpj => {
        expect(CNPJValidator.isValidCheckDigits(cnpj)).toBe(false);
      });
    });

    it('deve rejeitar CNPJs com todos dígitos iguais', () => {
      expect(CNPJValidator.isValidCheckDigits('00000000000000')).toBe(false);
      expect(CNPJValidator.isValidCheckDigits('11111111111111')).toBe(false);
      expect(CNPJValidator.isValidCheckDigits('22222222222222')).toBe(false);
    });
  });

  describe('isValid', () => {
    it('deve validar CNPJs corretos', () => {
      validCNPJs.forEach(cnpj => {
        expect(CNPJValidator.isValid(cnpj)).toBe(true);
      });
    });

    it('deve invalidar CNPJs incorretos', () => {
      invalidCNPJs.forEach(cnpj => {
        expect(CNPJValidator.isValid(cnpj)).toBe(false);
      });
    });
  });

  describe('format', () => {
    it('deve formatar CNPJ com máscara', () => {
      expect(CNPJValidator.format('45723564000190')).toBe('45.723.564/0001-90');
      expect(CNPJValidator.format('45175209000124')).toBe('45.175.209/0001-24');
      expect(CNPJValidator.format('00000000000191')).toBe('00.000.000/0001-91');
    });

    it('deve retornar input inalterado se formato inválido', () => {
      expect(CNPJValidator.format('123')).toBe('123');
      expect(CNPJValidator.format('invalid')).toBe('invalid');
    });
  });

  describe('unformat', () => {
    it('deve remover formatação', () => {
      expect(CNPJValidator.unformat('45.723.564/0001-90')).toBe('45723564000190');
      expect(CNPJValidator.unformat('45.175.209/0001-24')).toBe('45175209000124');
      expect(CNPJValidator.unformat('00000000000191')).toBe('00000000000191');
    });
  });

  describe('getErrorMessage', () => {
    it('deve retornar mensagem para CNPJ vazio', () => {
      expect(CNPJValidator.getErrorMessage('')).toBe('CNPJ é obrigatório');
      expect(CNPJValidator.getErrorMessage('   ')).toBe('CNPJ é obrigatório');
    });

    it('deve retornar mensagem para formato inválido', () => {
      expect(CNPJValidator.getErrorMessage('123')).toBe('CNPJ deve conter 14 dígitos numéricos');
      expect(CNPJValidator.getErrorMessage('abc')).toBe('CNPJ deve conter 14 dígitos numéricos');
    });

    it('deve retornar mensagem para dígitos repetidos', () => {
      expect(CNPJValidator.getErrorMessage('00000000000000')).toBe('CNPJ com dígitos repetidos é inválido');
      expect(CNPJValidator.getErrorMessage('11111111111111')).toBe('CNPJ com dígitos repetidos é inválido');
    });

    it('deve retornar mensagem para dígitos verificadores incorretos', () => {
      expect(CNPJValidator.getErrorMessage('45723564000191')).toBe('CNPJ inválido - dígitos verificadores incorretos');
      expect(CNPJValidator.getErrorMessage('45175209000125')).toBe('CNPJ inválido - dígitos verificadores incorretos');
    });
  });
});