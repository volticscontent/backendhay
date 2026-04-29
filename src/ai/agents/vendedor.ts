import { AgentContext, AgentMessage } from '../types';
import { runAgent, ToolDefinition } from '../openai-client';
import {
    tryScheduleMeeting, searchServices,
    setAgentRouting, sendMeetingForm, updateUser, callAttendant
} from '../server-tools';
import { prepareAgentContext, getSharedTools } from '../shared-agent';

export const VENDEDOR_PROMPT_TEMPLATE = `
# Identidade e Propósito

Você é o Icaro. Você é o Consultor Comercial Sênior da Haylander Martins Contabilidade.
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

**POSTURA E TOM DE VOZ (LIDERANÇA E EMPATIA):**
- **Liderança de Conversa (Leading):** VOCÊ é o consultor sênior. Lidere o fluxo. Cada resposta sua deve terminar com um call-to-action (CTA) ou pergunta que aproxime o cliente do agendamento.
- **Empatia:** "Sei como dívida tira o sono, mas vamos resolver isso juntos."
- **Objetividade Suave:** Mensagens curtas e amigáveis.
- **Consultivo e Seguro:** Mostre que a Haylander resolve.
- **SEPARAÇÃO DE MENSAGENS (MUITO IMPORTANTE):** Use '|||' para separar blocos lógicos.
  Exemplo: "Olá, João! Tudo bem? ||| Vi que o Apolo já te adiantou como funciona. O próximo passo é escolhermos o melhor horário para você conversar com o Haylander. Pode ser? 👇" (E chama a tool).

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
- **DEDUPLICAÇÃO DE INFORMAÇÃO:** Ao usar ferramentas como 'enviar_midia' ou 'enviar_link_reuniao', você não deve repetir links ou caminhos de arquivos no seu texto. Apenas introduza a ação de forma natural e proativa.
- **PROATIVIDADE (FLUXO CONTÍNUO):** Seu objetivo é a reunião. Se o cliente parou de responder após você enviar um link, ou se ele está em dúvida, seja proativo e sugira o próximo passo ou tente entender o que falta para ele avançar.
- **CHAMAR ATENDENTE:** Se o cliente exigir falar com o Haylander ou houver uma objeção que você não consiga contornar, use 'chamar_atendente'. **OBRIGATÓRIO:** No campo 'reason', resuma o que o cliente quer e qual o entrave atual.
`;

export async function runVendedorAgent(message: AgentMessage, context: AgentContext) {
    const sharedCtx = await prepareAgentContext(context);

    const systemPrompt = VENDEDOR_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', sharedCtx.userData)
        .replace('{{MEDIA_LIST}}', sharedCtx.mediaList)
        .replace('{{DYNAMIC_CONTEXT}}', sharedCtx.dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', sharedCtx.attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', sharedCtx.outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', sharedCtx.currentDate);

    const customTools: ToolDefinition[] = [
        {
            name: 'enviar_link_reuniao',
            description: 'Envia link de agendamento para consulta simples. Para lead com urgência e intenção de fechar, use agendar_reuniao_fechamento.',
            parameters: { type: 'object', properties: {} },
            function: async () => {
                await updateUser({ telefone: context.userPhone, status_atendimento: 'reuniao_pendente' });
                return sendMeetingForm(context.userPhone);
            }
        },
        {
            name: 'agendar_reuniao_fechamento',
            description: 'Use quando o lead confirmou intenção de contratar. Envia o link de reunião E notifica o Haylander com urgência e resumo completo do lead.',
            parameters: {
                type: 'object',
                properties: {
                    resumo: { type: 'string', description: 'Resumo BANT: problema, urgência, faturamento, TAG, histórico da conversa.' }
                },
                required: ['resumo']
            },
            function: async (args: any) => {
                await updateUser({ telefone: context.userPhone, status_atendimento: 'reuniao_fechamento' });
                const [meetingResult] = await Promise.all([
                    sendMeetingForm(context.userPhone),
                    callAttendant(
                        context.userPhone,
                        `🔴 REUNIÃO DE FECHAMENTO\n\nLead: ${context.userPhone}\n\n${args.resumo}\n\nAção: Confirme disponibilidade antes da chamada.`
                    )
                ]);
                return meetingResult;
            }
        },
        { name: 'tentar_agendar', description: 'Tentar agendar reunião (verifica disponibilidade).', parameters: { type: 'object', properties: { data_horario: { type: 'string', description: 'Data e hora (ex: 25/12/2023 14:00)' } }, required: ['data_horario'] }, function: async (args) => await tryScheduleMeeting(context.userPhone, args.data_horario as string) },
        {
            name: 'finalizar_atendimento_vendas', description: 'Encerra o atendimento comercial e devolve ao suporte.',
            parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
            function: async (args) => { await updateUser({ telefone: context.userPhone, observacoes: `[FIM VENDA] ${args.motivo}` }); return await setAgentRouting(context.userPhone, null); }
        },
        { name: 'services', description: 'Consultar informações sobre serviços.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, function: async (args) => await searchServices(args.query as string) }
    ];

    const tools = [...getSharedTools(context), ...customTools];

    return runAgent(systemPrompt, message, context, tools);
}
