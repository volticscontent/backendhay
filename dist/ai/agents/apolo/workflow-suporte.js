"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSuporteTools = exports.SUPORTE_RULES = void 0;
const server_tools_1 = require("../../server-tools");
exports.SUPORTE_RULES = `
# Regras de Suporte e Transbordo Humano
- **CHAMAR ATENDENTE:** Quando o cliente pedir para falar com um humano, usar a palavra "atendente" ou se você perceber que não consegue resolver algo complexo (ex: dúvidas técnicas específicas não cobertas, cliente com muita resistência), use a ferramenta 'chamar_atendente'.
- **IMPORTANTE:** Forneça um resumo detalhado no campo 'reason' sobre o motivo da transferência e o status da conversa para que o atendente humano tenha contexto.
`;
const getSuporteTools = (context) => [
    {
        name: 'chamar_atendente',
        description: 'Transferir a conversa para um atendente humano.',
        parameters: { type: 'object', properties: { reason: { type: 'string' } } },
        function: async (args) => await (0, server_tools_1.callAttendant)(context.userPhone, args.reason)
    }
];
exports.getSuporteTools = getSuporteTools;
//# sourceMappingURL=workflow-suporte.js.map