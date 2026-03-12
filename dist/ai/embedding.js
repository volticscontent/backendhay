"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbedding = generateEmbedding;
const openai_1 = __importDefault(require("openai"));
const logger_1 = __importDefault(require("../lib/logger"));
const log = logger_1.default.child('Embedding');
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
});
async function generateEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
            encoding_format: 'float',
        });
        return response.data[0].embedding;
    }
    catch (error) {
        log.error('Erro ao gerar embedding:', error);
        return [];
    }
}
//# sourceMappingURL=embedding.js.map