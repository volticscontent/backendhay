"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VENDEDOR_PROMPT_TEMPLATE = void 0;
exports.runVendedorAgent = runVendedorAgent;
const openai_client_1 = require("../openai-client");
const logger_1 = require("../../lib/logger");
const server_tools_1 = require("../server-tools");
const knowledge_base_1 = require("../knowledge-base");
exports.VENDEDOR_PROMPT_TEMPLATE = `
# Identidade e Propósito

Você é o Icaro. Você é o Consultor Comercial Sênior da Haylander Contabilidade.
Hoje é: {{CURRENT_DATE}}
Você recebe o bastão do Apolo (SDR) quando o lead já passou pela qualificação.

{{DYNAMIC_CONTEXT}}
{{ATTENDANT_WARNING}}
{{OUT_OF_HOURS_WARNING}}

**SUA NOVA MISSÃO CRÍTICA (REPESCAGEM):**
Você agora atende também os leads marcados como **"desqualificado"**.
Investigue planos futuros e tente reverter a desqualificação para agendar a reunião.

**CLIENTES RECORRENTES (Cross-sell):**
Atenda clientes transferidos do Suporte buscando novos serviços. Use **finalizar_atendimento_vendas** ao terminar.

**SUA MISSÃO PADRÃO:**
Atuar de forma consultiva para **agendar a Reunião de Fechamento com o Haylander (o Especialista)**.
Você **NÃO** gera contratos. Você prepara o terreno, valida a necessidade e garante que o cliente chegue na reunião pronto.

**POSTURA E TOM DE VOZ (SUPER HUMANO E EMPÁTICO):**
- **Empatia:** "Sei como dívida tira o sono, mas vamos resolver isso."
- **Objetividade Suave:** Mensagens curtas e amigáveis.
- **Consultivo e Seguro:** Mostre que a Haylander resolve.
- **SEPARAÇÃO DE MENSAGENS (MUITO IMPORTANTE):** Use '|||' para separar blocos lógicos.
  Exemplo: "Olá, João! Tudo bem? ||| Vi aqui que você está precisando de ajuda."

**FLUXO DE AGENDAMENTO DE REUNIÃO (O SEU MAIOR OBJETIVO):**
1. **Envie o link de agendamento:** "Separei um link para você escolher o melhor horário. 👇" e use **enviar_link_reuniao**.
2. **Resistência / Agendamento Manual:** Se o cliente não quiser usar o link, use **tentar_agendar**.

# Contexto do Cliente
<user_data>
{{USER_DATA}}
</user_data>

# Ferramentas Disponíveis
1. **enviar_link_reuniao** — Gera e envia o link de agendamento.
2. **tentar_agendar** — Agendamento manual por data/hora.
3. **finalizar_atendimento_vendas** — Encerra atendimento comercial e devolve ao suporte.
4. **update_user** — Atualizar dados do cliente. Sempre salve observações relevantes.
5. **chamar_atendente** — Transferir para humano.
6. **enviar_midia** — Enviar materiais de apoio.
7. **services** — Consultar informações sobre serviços.
8. **interpreter** — Memória compartilhada (post/get).

{{MEDIA_LIST}}

# Regras de Ouro
- Mensagens fragmentadas com '|||'.
- Nunca gere contrato ou prometa honorários fechados para serviços complexos.
- **PROIBIDO NARRAR TOOLS DE MÍDIA:** Ao usar a tool 'enviar_midia', NUNCA escreva no texto links fictícios ou o conteúdo do arquivo. A tool já faz o envio real do arquivo diretamente no WhatsApp do cliente automaticamente. Se quiser, apenas avise que o arquivo está sendo enviado.
- **EXCEÇÃO IMPORTANTE (O QUE VOCÊ DEVE ENVIAR):** A tool 'enviar_link_reuniao' NÃO ENVIA MENSAGEM AUTOMÁTICA! Ela apenas gera o link. Quando você usar essa tool, você DEVE OBRIGATORIAMENTE pegar o link retornado e colocá-lo no seu próprio texto de resposta para o cliente clicar!
`;
async function runVendedorAgent(message, context) {
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
    let mediaList = "Nenhuma mídia disponível.";
    let dynamicContext = "";
    try {
        [mediaList, dynamicContext] = await Promise.all([(0, server_tools_1.getAvailableMedia)(), (0, knowledge_base_1.getDynamicContext)()]);
    }
    catch (e) {
        logger_1.agentLogger.warn("Error:", e);
    }
    const attendantWarning = context.attendantRequestedReason ? `\n[ATENÇÃO: ATENDENTE HUMANO SOLICITADO]\nO cliente solicitou atendimento humano pelo seguinte motivo: "${context.attendantRequestedReason}". O humano já foi notificado e responderá em breve. Enquanto o humano não chega, mantenha o diálogo e tente ir adiantando as informações ou acolhendo o cliente de forma empática avisando que a equipe humana está a caminho.\n` : '';
    const outOfHoursWarning = context.outOfHours ? `\n[ATENÇÃO: EMPRESA FECHADA]\nNeste exato momento, a Haylander Contabilidade está fora do horário comercial (fechada). A sua missão principal AGORA é avisar o cliente de forma amigável e sutil na sua primeira mensagem que o expediente já se encerrou, MAS que você está lá para adiantar o lado dele recolhendo informações. Mantenha o fluxo normal, use as tools se precisar, apenas deixe claro que um humano só responderá no próximo dia útil.\n` : '';
    const systemPrompt = exports.VENDEDOR_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', userData)
        .replace('{{MEDIA_LIST}}', mediaList)
        .replace('{{DYNAMIC_CONTEXT}}', dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const tools = [
        { name: 'context_retrieve', description: 'Buscar o contexto recente da conversa.', parameters: { type: 'object', properties: { limit: { type: 'number' } } }, function: async (args) => await (0, server_tools_1.contextRetrieve)(context.userId, typeof args.limit === 'number' ? args.limit : 30) },
        { name: 'enviar_link_reuniao', description: 'Gera e envia o link de agendamento.', parameters: { type: 'object', properties: {} }, function: async () => await (0, server_tools_1.sendMeetingForm)(context.userPhone) },
        { name: 'tentar_agendar', description: 'Tentar agendar reunião (verifica disponibilidade).', parameters: { type: 'object', properties: { data_horario: { type: 'string', description: 'Data e hora (ex: 25/12/2023 14:00)' } }, required: ['data_horario'] }, function: async (args) => await (0, server_tools_1.tryScheduleMeeting)(context.userPhone, args.data_horario) },
        {
            name: 'finalizar_atendimento_vendas', description: 'Encerra o atendimento comercial e devolve ao suporte.',
            parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
            function: async (args) => { await (0, server_tools_1.updateUser)({ telefone: context.userPhone, observacoes: `[FIM VENDA] ${args.motivo}` }); return await (0, server_tools_1.setAgentRouting)(context.userPhone, null); }
        },
        { name: 'chamar_atendente', description: 'Chamar atendente humano.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }, function: async (args) => await (0, server_tools_1.callAttendant)(context.userPhone, args.reason) },
        { name: 'update_user', description: 'Atualizar dados do usuário.', parameters: { type: 'object', properties: { situacao: { type: 'string' }, observacoes: { type: 'string' }, tipo_negocio: { type: 'string' }, tem_divida: { type: 'boolean' }, valor_divida_federal: { type: 'string' }, cnpj: { type: 'string' }, razao_social: { type: 'string' }, faturamento_mensal: { type: 'string' } } }, function: async (args) => await (0, server_tools_1.updateUser)({ telefone: context.userPhone, ...args }) },
        { name: 'services', description: 'Consultar informações sobre serviços.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, function: async (args) => await (0, server_tools_1.searchServices)(args.query) },
        { name: 'enviar_midia', description: 'Enviar um arquivo de mídia.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, function: async (args) => await (0, server_tools_1.sendMedia)(context.userPhone, args.key) },
        { name: 'interpreter', description: 'Memória compartilhada (post/get).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['post', 'get'] }, text: { type: 'string' }, category: { type: 'string', enum: ['qualificacao', 'vendas', 'atendimento'] } }, required: ['action', 'text'] }, function: async (args) => await (0, server_tools_1.interpreter)(context.userPhone, args.action, args.text, args.category) },
    ];
    return (0, openai_client_1.runAgent)(systemPrompt, message, context, tools);
}
//# sourceMappingURL=vendedor.js.map