/**
 * Teste para debug do axios.isAxiosError
 */

import axios from 'axios';

describe('Axios Debug - Verificação detalhada', () => {
  it('deve testar diferentes formas de criar erro axios', async () => {
    // Forma 1: Criar erro manualmente
    const error1 = new Error('Request failed with status code 404');
    (error1 as any).response = { status: 404 };
    (error1 as any).isAxiosError = true;
    
    console.log('Erro 1 - axios.isAxiosError:', axios.isAxiosError(error1));
    console.log('Erro 1 - typeof:', typeof error1);
    console.log('Erro 1 - constructor:', error1.constructor.name);
    
    // Forma 2: Usar axios.createError (se disponível)
    try {
      const error2 = (axios as any).createError('Request failed', { response: { status: 404 } });
      console.log('Erro 2 - axios.isAxiosError:', axios.isAxiosError(error2));
    } catch (e) {
      console.log('axios.createError não disponível');
    }
    
    // Forma 3: Mock do jest
    const mockError = {
      response: { status: 404 },
      isAxiosError: true,
      message: 'Request failed with status code 404'
    };
    
    console.log('Mock Error - axios.isAxiosError:', axios.isAxiosError(mockError));
  });
});