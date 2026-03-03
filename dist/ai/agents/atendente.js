"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATENDENTE_PROMPT_TEMPLATE = void 0;
exports.runAtendenteAgent = runAtendenteAgent;
const openai_client_1 = require("../openai-client");
const server_tools_1 = require("../server-tools");
const knowledge_base_1 = require("../knowledge-base");
exports.ATENDENTE_PROMPT_TEMPLATE = `
# Identidade e Propósito
Você é o Apolo (versão Atendimento ao Cliente).
Hoje é: {{CURRENT_DATE}}
Você atende clientes que já estão na base (Situação = Cliente).

{{DYNAMIC_CONTEXT}}

**SUA MISSÃO:**
Garantir que os dados do cliente estejam atualizados e oferecer suporte inicial.
**OBJETIVO PRINCIPAL:** Blindar o time humano. Resolva TUDO o que for possível sozinho.

**POSTURA E TOM DE VOZ (SUPER HUMANO E EMPÁTICO):**
- **Sinceridade e Foco:** Seja claro, direto, resolutivo, mas muito acolhedor.
- **SEPARAÇÃO DE MENSAGENS (MUITO IMPORTANTE):** Use '|||' para separar blocos lógicos.
  Exemplo: "Oi! Tudo bem? ||| Deixa comigo, vou atualizar os dados aqui."

**PROCEDIMENTO PADRÃO:**
1. Identifique o pedido do cliente.
2. Verifique se os dados essenciais estão preenchidos.
3. Se faltar algo, peça apenas o que falta.
4. Se o cliente pedir atualização de dados, use **update_user**.
5. Se complexo/urgente, use **chamar_atendente**.
6. Se o cliente expressar interesse em novo serviço, use **iniciar_nova_venda**.

### Fallback de Regularização / Procuração e-CAC
Se o cliente não conseguiu fazer a procuração:
1. Acalme o cliente e faça a consulta manualmente.
2. Verifique dados básicos (Nome, CPF/CNPJ).
3. Envie formulário solicitando Senha GOV e explique o motivo.

Informações Reais do Cliente:
<user_data>
{{USER_DATA}}
</user_data>

# Ferramentas Disponíveis
1. **update_user** — Registrar/atualizar dados cadastrais e observações.
2. **chamar_atendente** — Transferir para humano.
3. **iniciar_nova_venda** — Transferir para vendas (novo serviço).
4. **enviar_midia** — Enviar tutoriais/manuais.
5. **interpreter** — Memória compartilhada (post/get).

{{MEDIA_LIST}}
`;
async function runAtendenteAgent(message, context) {
    const userDataJson = await (0, server_tools_1.getUser)(context.userPhone);
    let userData = "Não encontrado";
    try {
        const parsed = JSON.parse(userDataJson);
        if (parsed.status !== 'error' && parsed.status !== 'not_found') {
            const allowedKeys = ['telefone', 'nome_completo', 'email', 'situacao', 'qualificacao', 'observacoes', 'faturamento_mensal', 'tem_divida', 'tipo_negocio', 'possui_socio'];
            userData = Object.entries(parsed).filter(([k]) => allowedKeys.includes(k)).map(([k, v]) => `${k} = ${v}`).join('\n');
        }
    }
    catch { }
    const [availableMedia, dynamicContext] = await Promise.all([(0, server_tools_1.getAvailableMedia)(), (0, knowledge_base_1.getDynamicContext)()]);
    const systemPrompt = exports.ATENDENTE_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', userData)
        .replace('{{MEDIA_LIST}}', availableMedia)
        .replace('{{DYNAMIC_CONTEXT}}', dynamicContext)
        .replace('{{CURRENT_DATE}}', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const tools = [
        { name: 'enviar_midia', description: 'Enviar um arquivo de mídia.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, function: async (args) => await (0, server_tools_1.sendMedia)(context.userPhone, args.key) },
        { name: 'context_retrieve', description: 'Buscar o contexto recente da conversa.', parameters: { type: 'object', properties: { limit: { type: 'number' } } }, function: async (args) => await (0, server_tools_1.contextRetrieve)(context.userId, typeof args.limit === 'number' ? args.limit : 30) },
        { name: 'update_user', description: 'Atualizar dados do usuário.', parameters: { type: 'object', properties: { nome_completo: { type: 'string' }, cnpj: { type: 'string' }, email: { type: 'string' }, observacoes: { type: 'string' } } }, function: async (args) => await (0, server_tools_1.updateUser)({ telefone: context.userPhone, ...args }) },
        { name: 'chamar_atendente', description: 'Chamar atendente humano.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }, function: async (args) => await (0, server_tools_1.callAttendant)(context.userPhone, args.reason) },
        {
            name: 'iniciar_nova_venda', description: 'Transferir para o time de vendas para novos serviços.',
            parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
            function: async (args) => { await (0, server_tools_1.updateUser)({ telefone: context.userPhone, observacoes: `[NOVA VENDA] Cliente interessado em: ${args.motivo}` }); return await (0, server_tools_1.setAgentRouting)(context.userPhone, 'vendedor'); }
        },
        { name: 'interpreter', description: 'Memória compartilhada (post/get).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['post', 'get'] }, text: { type: 'string' }, category: { type: 'string', enum: ['qualificacao', 'vendas', 'atendimento'] } }, required: ['action', 'text'] }, function: async (args) => await (0, server_tools_1.interpreter)(context.userPhone, args.action, args.text, args.category) },
    ];
    return (0, openai_client_1.runAgent)(systemPrompt, message, context, tools);
}
//# sourceMappingURL=atendente.js.map