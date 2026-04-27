/**
 * Testes unitários para CNPJService
 */

import axios from 'axios';
import { cnpjService, CNPJData } from '../cnpj-service';

// Mock do axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CNPJService', () => {
  // CNPJs de teste
  const validCNPJ = '45723564000190';
  const invalidCNPJ = '00000000000000';
  const notFoundCNPJ = '99999999999999';

  // Dados mock da API (estrutura real da BrasilAPI)
  const mockCNPJData: CNPJData = {
    cnpj: '45723564000190',
    razao_social: 'HAYLANDER MARTINS CONTABILIDADE LTDA',
    nome_fantasia: 'Haylander Contabilidade',
    situacao_cadastral: 'ATIVA',
    data_situacao_cadastral: '2020-01-15',
    motivo_situacao_cadastral: 'SEM MOTIVO',
    endereco: {
      logradouro: 'RUA DAS FLORES',
      numero: '123',
      complemento: 'SALA 45',
      bairro: 'CENTRO',
      municipio: 'SÃO PAULO',
      uf: 'SP',
      cep: '01000000'
    },
    atividades_principais: [{
      code: '6920-6/01',
      text: 'Atividades de contabilidade'
    }],
    atividades_secundarias: [],
    telefone: '1133334444',
    email: 'contato@haylander.com.br',
    data_abertura: '2020-01-15',
    capital_social: 100000,
    porte: 'DEMAIS',
    natureza_juridica: '206-2 - SOCIEDADE EMPRESÁRIA LIMITADA',
    qsa: []
  };

  beforeEach(() => {
    // Limpa o cache antes de cada teste
    cnpjService.clearCache();
    jest.clearAllMocks();
  });

  describe('consultarCNPJ', () => {
    it('deve retornar dados do CNPJ quando a consulta for bem-sucedida', async () => {
      // Mock da estrutura real da BrasilAPI
      const brasilAPIData = {
        cnpj: '45723564000190',
        razao_social: 'HAYLANDER MARTINS CONTABILIDADE LTDA',
        nome_fantasia: 'Haylander Contabilidade',
        descricao_situacao_cadastral: 'ATIVA',
        data_situacao_cadastral: '2020-01-15',
        descricao_motivo_situacao_cadastral: 'SEM MOTIVO',
        logradouro: 'RUA DAS FLORES',
        numero: '123',
        complemento: 'SALA 45',
        bairro: 'CENTRO',
        municipio: 'SÃO PAULO',
        uf: 'SP',
        cep: '01000000',
        cnae_fiscal: '6920-6/01',
        cnae_fiscal_descricao: 'Atividades de contabilidade',
        cnae_fiscal_secundaria: [],
        ddd_telefone_1: '1133334444',
        email: 'contato@haylander.com.br',
        data_inicio_atividade: '2020-01-15',
        capital_social: '100000',
        descricao_porte: 'DEMAIS',
        natureza_juridica: '206-2 - SOCIEDADE EMPRESÁRIA LIMITADA',
        qsa: []
      };

      mockedAxios.get.mockResolvedValueOnce({ data: brasilAPIData });

      const result = await cnpjService.consultarCNPJ(validCNPJ);

      expect(result.success).toBe(true);
      expect(result.data?.cnpj).toBe('45723564000190');
      expect(result.data?.razao_social).toBe('HAYLANDER MARTINS CONTABILIDADE LTDA');
      expect(result.api_source).toBe('brasilapi');
      expect(result.cached).toBe(false);
      expect(result.timestamp).toBeDefined();
    });

    it('deve usar cache em consultas repetidas', async () => {
      // Mock da estrutura real da BrasilAPI
      const brasilAPIData = {
        cnpj: '45723564000190',
        razao_social: 'HAYLANDER MARTINS CONTABILIDADE LTDA',
        nome_fantasia: 'Haylander Contabilidade',
        descricao_situacao_cadastral: 'ATIVA',
        data_situacao_cadastral: '2020-01-15',
        descricao_motivo_situacao_cadastral: 'SEM MOTIVO',
        logradouro: 'RUA DAS FLORES',
        numero: '123',
        complemento: 'SALA 45',
        bairro: 'CENTRO',
        municipio: 'SÃO PAULO',
        uf: 'SP',
        cep: '01000000',
        cnae_fiscal: '6920-6/01',
        cnae_fiscal_descricao: 'Atividades de contabilidade',
        cnae_fiscal_secundaria: [],
        ddd_telefone_1: '1133334444',
        email: 'contato@haylander.com.br',
        data_inicio_atividade: '2020-01-15',
        capital_social: '100000',
        descricao_porte: 'DEMAIS',
        natureza_juridica: '206-2 - SOCIEDADE EMPRESÁRIA LIMITADA',
        qsa: []
      };

      mockedAxios.get.mockResolvedValueOnce({ data: brasilAPIData });

      // Primeira consulta
      const result1 = await cnpjService.consultarCNPJ(validCNPJ);
      expect(result1.cached).toBe(false);

      // Segunda consulta (deve usar cache)
      const result2 = await cnpjService.consultarCNPJ(validCNPJ);
      expect(result2.cached).toBe(true);
      expect(result2.api_source).toBe('cache');

      // Axios só deve ter sido chamado uma vez
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('deve retornar erro para CNPJ inválido', async () => {
      const result = await cnpjService.consultarCNPJ(invalidCNPJ);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CNPJ');
      expect(result.error?.message).toContain('CNPJ com dígitos repetidos é inválido');
      expect(result.data).toBeUndefined();
    });

    it('deve retornar erro quando CNPJ não for encontrado', async () => {
      // Mock de CNPJ válido para passar na validação
      const validNotFoundCNPJ = '11222333000181';
      
      // Mock do axios com erro 404
      const axiosError = new Error('Request failed with status code 404');
      (axiosError as any).response = { status: 404 };
      (axiosError as any).isAxiosError = true;
      
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      const result = await cnpjService.consultarCNPJ(validNotFoundCNPJ);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CNPJ_NOT_FOUND');
      expect(result.error?.message).toBe('CNPJ não encontrado na base de dados');
    });

    it('deve retornar erro de timeout', async () => {
      // Mock do axios com timeout
      const axiosError = new Error('timeout of 10000ms exceeded');
      (axiosError as any).code = 'ECONNABORTED';
      (axiosError as any).isAxiosError = true;
      
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      const result = await cnpjService.consultarCNPJ(validCNPJ);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toBe('Timeout na consulta. Tente novamente.');
    });

    it('deve aplicar rate limiting', async () => {
      // Mock da estrutura real da BrasilAPI
      const brasilAPIData = {
        cnpj: '45723564000190',
        razao_social: 'HAYLANDER MARTINS CONTABILIDADE LTDA',
        nome_fantasia: 'Haylander Contabilidade',
        descricao_situacao_cadastral: 'ATIVA',
        data_situacao_cadastral: '2020-01-15',
        descricao_motivo_situacao_cadastral: 'SEM MOTIVO',
        logradouro: 'RUA DAS FLORES',
        numero: '123',
        complemento: 'SALA 45',
        bairro: 'CENTRO',
        municipio: 'SÃO PAULO',
        uf: 'SP',
        cep: '01000000',
        cnae_fiscal: '6920-6/01',
        cnae_fiscal_descricao: 'Atividades de contabilidade',
        cnae_fiscal_secundaria: [],
        ddd_telefone_1: '1133334444',
        email: 'contato@haylander.com.br',
        data_inicio_atividade: '2020-01-15',
        capital_social: '100000',
        descricao_porte: 'DEMAIS',
        natureza_juridica: '206-2 - SOCIEDADE EMPRESÁRIA LIMITADA',
        qsa: []
      };

      mockedAxios.get.mockResolvedValue({ data: brasilAPIData });

      const clientIp = '192.168.1.1';
      
      // Faz 10 requisições (limite)
      for (let i = 0; i < 10; i++) {
        const result = await cnpjService.consultarCNPJ(validCNPJ, clientIp);
        expect(result.success).toBe(true);
      }

      // 11ª requisição deve ser bloqueada
      const result = await cnpjService.consultarCNPJ(validCNPJ, clientIp);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(result.error?.message).toContain('Limite de requisições excedido');
    });
  });

  describe('consultarLote', () => {
    it('deve consultar múltiplos CNPJs em lote', async () => {
      mockedAxios.get.mockResolvedValue({ data: mockCNPJData });

      const cnpjs = [validCNPJ, '45175209000124', '14511139000104'];
      const results = await cnpjService.consultarLote(cnpjs);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.timestamp).toBeDefined();
      });
    });

    it('deve retornar resultados mistos (sucessos e erros)', async () => {
      // Mock de CNPJ válido para passar na validação
      const validNotFoundCNPJ = '11222333000181';
      
      // Mock do axios com erro 404
      const axiosError = new Error('Request failed with status code 404');
      (axiosError as any).response = { status: 404 };
      (axiosError as any).isAxiosError = true;
      
      mockedAxios.get
        .mockResolvedValueOnce({ data: mockCNPJData }) // Primeiro válido
        .mockRejectedValueOnce(axiosError); // Segundo não encontrado

      const cnpjs = [validCNPJ, validNotFoundCNPJ];
      const results = await cnpjService.consultarLote(cnpjs);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error?.code).toBe('CNPJ_NOT_FOUND');
    });
  });

  describe('cache', () => {
    it('deve armazenar e recuperar dados do cache', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockCNPJData });

      // Primeira consulta popula o cache
      await cnpjService.consultarCNPJ(validCNPJ);

      // Verifica estatísticas do cache
      const stats = cnpjService.getCacheStats();
      expect(stats.size).toBe(1);

      // Limpa o cache
      cnpjService.clearCache();
      
      const statsAfterClear = cnpjService.getCacheStats();
      expect(statsAfterClear.size).toBe(0);
    });
  });
});