import { AgentContext, AgentMessage } from '../types';
import { runAgent, ToolDefinition } from '../openai-client';
import {
    updateUser, getUser, callAttendant, contextRetrieve,
    interpreter, sendMedia, getAvailableMedia, setAgentRouting, getUpdatableFields
} from '../server-tools';
import { getDynamicContext } from '../knowledge-base';

export const ATENDENTE_PROMPT_TEMPLATE = `
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
`;

export async function runAtendenteAgent(message: AgentMessage, context: AgentContext) {
    const userDataJson = await getUser(context.userPhone);
    let userData = "Não encontrado";
    try {
        const parsed = JSON.parse(userDataJson);
        if (parsed.status !== 'error' && parsed.status !== 'not_found') {
            const allowedKeys = ['telefone', 'nome_completo', 'email', 'situacao', 'qualificacao', 'observacoes', 'faturamento_mensal', 'tem_divida', 'tipo_negocio', 'possui_socio'];
            userData = Object.entries(parsed).filter(([k]) => allowedKeys.includes(k)).map(([k, v]) => `${k} = ${v}`).join('\n');
        }
    } catch { }

    const [availableMedia, dynamicContext] = await Promise.all([getAvailableMedia(), getDynamicContext()]);

    const attendantWarning = context.attendantRequestedReason ? `\n[ATENÇÃO: ATENDENTE HUMANO SOLICITADO]\nO cliente solicitou atendimento humano pelo seguinte motivo: "${context.attendantRequestedReason}". O humano já foi notificado e responderá em breve. Enquanto o humano não chega, mantenha o diálogo e tente ir adiantando as informações ou acolhendo o cliente de forma empática avisando que a equipe humana está a caminho.\n` : '';

    const outOfHoursWarning = context.outOfHours ? `\n[ATENÇÃO: EMPRESA FECHADA]\nNeste exato momento, a Haylander Contabilidade está fora do horário comercial (fechada). A sua missão principal AGORA é avisar o cliente de forma amigável e sutil na sua primeira mensagem que o expediente já se encerrou, MAS que você está lá para adiantar o lado dele recolhendo informações. Mantenha o fluxo normal, use as tools se precisar, apenas deixe claro que um humano só responderá no próximo dia útil.\n` : '';

    const systemPrompt = ATENDENTE_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', userData)
        .replace('{{MEDIA_LIST}}', availableMedia)
        .replace('{{DYNAMIC_CONTEXT}}', dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));

    const tools: ToolDefinition[] = [
        { name: 'enviar_midia', description: 'Enviar um arquivo de mídia.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, function: async (args) => await sendMedia(context.userPhone, args.key as string) },
        { name: 'context_retrieve', description: 'Buscar o contexto recente da conversa.', parameters: { type: 'object', properties: { limit: { type: 'number' } } }, function: async (args) => await contextRetrieve(context.userId, typeof args.limit === 'number' ? args.limit : 30) },
        { name: 'update_user', description: 'Atualizar dados do usuário.', parameters: { type: 'object', properties: { nome_completo: { type: 'string' }, cnpj: { type: 'string' }, email: { type: 'string' }, observacoes: { type: 'string' } }, additionalProperties: true }, function: async (args) => await updateUser({ telefone: context.userPhone, ...args as Record<string, string> }) },
        { name: 'listar_tabelas_e_campos', description: 'Retorna a lista completa de todas as tabelas e os campos que você tem permissão para atualizar usando a ferramenta update_user. Use isto se quiser saber exatamente quais variáveis pode enviar e atualizar.', parameters: { type: 'object', properties: {} }, function: async () => await getUpdatableFields() },
        { name: 'chamar_atendente', description: 'Chamar atendente humano.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }, function: async (args) => await callAttendant(context.userPhone, args.reason as string) },
        {
            name: 'iniciar_nova_venda', description: 'Transferir para o time de vendas para novos serviços.',
            parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
            function: async (args) => { await updateUser({ telefone: context.userPhone, observacoes: `[NOVA VENDA] Cliente interessado em: ${args.motivo}` }); return await setAgentRouting(context.userPhone, 'vendedor'); }
        },
        { name: 'interpreter', description: 'Memória compartilhada (post/get).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['post', 'get'] }, text: { type: 'string' }, category: { type: 'string', enum: ['qualificacao', 'vendas', 'atendimento'] } }, required: ['action', 'text'] }, function: async (args) => await interpreter(context.userPhone, args.action as 'post' | 'get', args.text as string, args.category as 'qualificacao' | 'vendas' | 'atendimento') },
    ];

    return runAgent(systemPrompt, message, context, tools);
}
