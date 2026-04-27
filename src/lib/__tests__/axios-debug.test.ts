/**
 * Teste para debug do axios.isAxiosError
 */

import axios from 'axios';

describe('Axios Debug', () => {
  it('deve reconhecer erro axios', () => {
    const axiosError = new Error('Request failed with status code 404');
    (axiosError as any).response = { status: 404 };
    (axiosError as any).isAxiosError = true;
    
    console.log('axios.isAxiosError:', axios.isAxiosError(axiosError));
    console.log('axiosError.response:', (axiosError as any).response);
    
    expect(axios.isAxiosError(axiosError)).toBe(true);
  });
});