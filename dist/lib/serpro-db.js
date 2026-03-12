"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveConsultation = saveConsultation;
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
async function saveConsultation(cnpj, service, result, status, source = 'bot') {
    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const query = `
      INSERT INTO consultas_serpro (cnpj, tipo_servico, resultado, status, source, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `;
        const res = await db_1.default.query(query, [cleanCnpj, service, result, status, source]);
        logger_1.dbLogger.debug(`Consulta Serpro salva. ID: ${res.rows[0].id}`);
    }
    catch (error) {
        logger_1.dbLogger.error('Erro ao salvar consulta Serpro:', error);
    }
}
//# sourceMappingURL=serpro-db.js.map