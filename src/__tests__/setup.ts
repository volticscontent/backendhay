// Setup global para testes
import { bootLogger } from '../lib/logger';

// Desabilita logs durante os testes para saída mais limpa
beforeAll(() => {
  jest.spyOn(bootLogger, 'info').mockImplementation(() => {});
  jest.spyOn(bootLogger, 'error').mockImplementation(() => {});
  jest.spyOn(bootLogger, 'warn').mockImplementation(() => {});
});

// Limpa mocks após cada teste
afterEach(() => {
  jest.clearAllMocks();
});

// Restaura logs após todos os testes
afterAll(() => {
  jest.restoreAllMocks();
});

// Timeout global para testes
jest.setTimeout(10000);