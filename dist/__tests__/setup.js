"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Setup global para testes
const logger_1 = require("../lib/logger");
// Desabilita logs durante os testes para saída mais limpa
beforeAll(() => {
    jest.spyOn(logger_1.bootLogger, 'info').mockImplementation(() => { });
    jest.spyOn(logger_1.bootLogger, 'error').mockImplementation(() => { });
    jest.spyOn(logger_1.bootLogger, 'warn').mockImplementation(() => { });
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
//# sourceMappingURL=setup.js.map