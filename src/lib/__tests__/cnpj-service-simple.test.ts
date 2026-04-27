/**
 * Teste simplificado para debug do serviço CNPJ
 */

import axios from 'axios';
import { cnpjService } from '../cnpj-service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CNPJService - Debug', () => {
  beforeEach(() => {
    cnpjService.clearCache();
    jest.clearAllMocks();
  });

  it('deve tratar erro 404 corretamente', async () => {
    // Cria um CNPJ válido
    const validCNPJ = '11222333000181';
    
    // Mock do axios com erro 404
    const axiosError = new Error('Request failed with status code 404');
    (axiosError as any).response = { status: 404 };
    (axiosError as any).isAxiosError = true;
    
    mockedAxios.get.mockRejectedValueOnce(axiosError);

    const result = await cnpjService.consultarCNPJ(validCNPJ);

    console.log('Resultado:', JSON.stringify(result, null, 2));
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CNPJ_NOT_FOUND');
  });
});