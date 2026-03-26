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
{{ATTENDANT_WARNING}}
{{OUT_OF_HOURS_WARNING}}

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

# Regras de Ouro
- Mensagens fragmentadas com '|||'.
- **PROIBIDO NARRAR TOOLS DE MÍDIA:** Ao usar a tool 'enviar_midia', NUNCA escreva no texto links fictícios ou o conteúdo do arquivo. A tool já faz o envio real do arquivo diretamente no WhatsApp do cliente automaticamente. Se quiser, apenas avise que o arquivo está sendo enviado.
- **CHAMAR ATENDENTE:** Use esta tool quando o problema for técnico ou exigir intervenção humana imediata. **OBRIGATÓRIO:** No campo 'reason', explique exatamente o problema (ex: "Cliente está com erro no portal e-CAC e precisa de suporte técnico").
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
    const attendantWarning = context.attendantRequestedReason ? `\n[ATENÇÃO: ATENDENTE HUMANO SOLICITADO]\nO cliente solicitou atendimento humano pelo seguinte motivo: "${context.attendantRequestedReason}". O humano já foi notificado e responderá em breve. Enquanto o humano não chega, mantenha o diálogo e tente ir adiantando as informações ou acolhendo o cliente de forma empática avisando que a equipe humana está a caminho.\n` : '';
    const outOfHoursWarning = context.outOfHours ? `\n[ATENÇÃO: HUMANO INDISPONÍVEL]\nNeste exato momento, o time humano da Haylander Martins Contabilidade está fora do horário comercial. VOCÊ deve continuar o suporte inicial normalmente. Avisar o cliente de forma amigável que o time humano responderá assim que retornar, mas que você está aqui para acolher e coletar as informações necessárias.\n` : '';
    const systemPrompt = exports.ATENDENTE_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', userData)
        .replace('{{MEDIA_LIST}}', availableMedia)
        .replace('{{DYNAMIC_CONTEXT}}', dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const tools = [
        { name: 'enviar_midia', description: 'Enviar um arquivo de mídia.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, function: async (args) => await (0, server_tools_1.sendMedia)(context.userPhone, args.key) },
        { name: 'context_retrieve', description: 'Buscar o contexto recente da conversa.', parameters: { type: 'object', properties: { limit: { type: 'number' } } }, function: async (args) => await (0, server_tools_1.contextRetrieve)(context.userId, typeof args.limit === 'number' ? args.limit : 30) },
        { name: 'update_user', description: 'Atualizar dados do usuário.', parameters: { type: 'object', properties: { nome_completo: { type: 'string' }, cnpj: { type: 'string' }, email: { type: 'string' }, observacoes: { type: 'string' } }, additionalProperties: true }, function: async (args) => await (0, server_tools_1.updateUser)({ telefone: context.userPhone, ...args }) },
        { name: 'listar_tabelas_e_campos', description: 'Retorna a lista completa de todas as tabelas e os campos que você tem permissão para atualizar usando a ferramenta update_user. Use isto se quiser saber exatamente quais variáveis pode enviar e atualizar.', parameters: { type: 'object', properties: {} }, function: async () => await (0, server_tools_1.getUpdatableFields)() },
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