"use strict";
/**
 * Teste simplificado para debug do serviço CNPJ
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cnpj_service_1 = require("../cnpj-service");
jest.mock('axios');
const mockedAxios = axios_1.default;
describe('CNPJService - Debug', () => {
    beforeEach(() => {
        cnpj_service_1.cnpjService.clearCache();
        jest.clearAllMocks();
    });
    it('deve tratar erro 404 corretamente', async () => {
        // Cria um CNPJ válido
        const validCNPJ = '11222333000181';
        // Mock do axios com erro 404
        const axiosError = new Error('Request failed with status code 404');
        axiosError.response = { status: 404 };
        axiosError.isAxiosError = true;
        mockedAxios.get.mockRejectedValueOnce(axiosError);
        const result = await cnpj_service_1.cnpjService.consultarCNPJ(validCNPJ);
        console.log('Resultado:', JSON.stringify(result, null, 2));
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('CNPJ_NOT_FOUND');
    });
});
//# sourceMappingURL=cnpj-service-simple.test.js.map