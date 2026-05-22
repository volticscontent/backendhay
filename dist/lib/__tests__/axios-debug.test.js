"use strict";
/**
 * Teste para debug do axios.isAxiosError
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
describe('Axios Debug', () => {
    it('deve reconhecer erro axios', () => {
        const axiosError = new Error('Request failed with status code 404');
        axiosError.response = { status: 404 };
        axiosError.isAxiosError = true;
        console.log('axios.isAxiosError:', axios_1.default.isAxiosError(axiosError));
        console.log('axiosError.response:', axiosError.response);
        expect(axios_1.default.isAxiosError(axiosError)).toBe(true);
    });
});
//# sourceMappingURL=axios-debug.test.js.map