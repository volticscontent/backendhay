"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComercialTools = exports.COMERCIAL_RULES = void 0;
const server_tools_1 = require("../../server-tools");
exports.COMERCIAL_RULES = `
# Regras Comerciais e Triagem
**FLUXO DE PENSAMENTO OBRIGATÓRIO (Chain of Thought):**
Antes de responder, você DEVE seguir este processo mental:
1. Faça 1 ou 2 perguntas curtas e amigáveis para descobrir o cenário básico (faturamento mensal aproximado e se tem dívidas), caso ele não tenha informado.
2. Com base nas respostas, classifique o lead AGORA (Respeite a ordem de PRECEDÊNCIA):
   - **REGRA 1 (CRÍTICA):** Faturamento É 'Até 5k' E SEM Dívida? -> **DESQUALIFICADO** (PARE AQUI!).
   - Faturamento > 10k? -> MQL
   - Tem Dívida (tem_divida = true)? -> MQL
   - Quer Abrir Empresa (Novo CNPJ)? -> MQL (Somente se NÃO cair na regra 1).
   - NENHUM dos acima? -> DESQUALIFICADO.
3. Se for QUALIFICADO (MQL ou SQL), você DEVE IMEDIATAMENTE chamar a tool update_user preenchendo 'qualificacao', 'motivo_qualificacao' e as informações extraídas.
4. **PASSAGEM DE BASTÃO:** Assim que chamar a update_user para qualificar, avise o cliente que um consultor entrará em contato.
5. Se for DESQUALIFICADO, chame update_user com {"situacao": "desqualificado"}.
6. **LINGUAGEM DE CONTADOR:** No campo 'observacoes' do update_user, salve resumos úteis para um contador, evitando termos técnicos.

### Acolhimento e Menu Inicial
- **REGRA DE OURO:** Se for a primeira mensagem, envie uma saudação e CHAME A TOOL 'enviar_lista_enumerada'.
`;
const getComercialTools = (context) => [
    { name: 'enviar_lista_enumerada', description: 'Exibir a lista de opções numerada (1-5) para o cliente via WhatsApp.', parameters: { type: 'object', properties: {} }, function: async () => await (0, server_tools_1.sendEnumeratedList)(context.userPhone) },
    { name: 'enviar_link_reuniao', description: 'Gera e envia o link de agendamento de reunião.', parameters: { type: 'object', properties: {} }, function: async () => await (0, server_tools_1.sendMeetingForm)(context.userPhone) },
    { name: 'update_user', description: 'Atualizar dados cadastrais ou status do lead no banco de dados.', parameters: { type: 'object', properties: { campos: { type: 'object', description: 'Objeto contendo os campos a serem atualizados (ex: { situacao: "qualificado" })' } } }, function: async (args) => await (0, server_tools_1.updateUser)({ ...args.campos, telefone: context.userPhone }) },
    { name: 'interpreter', description: 'Analista de memória e histórico de conversas do cliente.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['get', 'post'] }, text: { type: 'string' }, category: { type: 'string' } } }, function: async (args) => await (0, server_tools_1.interpreter)(context.userPhone, args.action, args.text, args.category) }
];
exports.getComercialTools = getComercialTools;
//# sourceMappingURL=workflow-comercial.js.map