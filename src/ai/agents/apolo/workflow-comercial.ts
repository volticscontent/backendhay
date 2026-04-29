import { ToolDefinition } from '../../openai-client';
import { sendEnumeratedList, sendMeetingForm, consultarCnpjPublico, callAttendant, updateUser } from '../../server-tools';
import { AgentContext } from '../../types';

export const COMERCIAL_RULES = `
# Regras Comerciais e Triagem

### Abertura — Primeira Mensagem
Na primeira mensagem: saudação calorosa + envie a apresentação comercial ('enviar_apresentacao_comercial') + pergunte como pode ajudar.
NÃO mande menu numerado. A conversa começa de forma natural.

### Quando o Cliente Fornece o CNPJ
1. Chame 'consultar_cnpj_publico' IMEDIATAMENTE — ela busca dados públicos (BrasilAPI) e já preenche a ficha automaticamente.
2. Confirme com o cliente os dados encontrados: "Vi que sua empresa é [razao_social], MEI no ramo de [tipo_negocio], em [cidade/UF]. Está correto?"
3. Se is_mei = true: confirme que é MEI antes de prosseguir.
4. Se situacao_cadastral for BAIXADA, INAPTA ou SUSPENSA: acolha e explique que podemos regularizar.
5. Se procuração ATIVA: prossiga direto para consultas Serpro (PGMEI, dívidas).
6. Se procuração AUSENTE: explique que a procuração e-CAC é OBRIGATÓRIA para prestarmos o serviço. Use 'enviar_processo_autonomo'.

### A Procuração e-CAC é OBRIGATÓRIA
A procuração não é uma opção — é um requisito técnico para acessarmos os sistemas da Receita Federal e prestar o serviço corretamente.
Enquanto o cliente não tiver a procuração ativa, não conseguimos consultar dívidas, emitir guias nem automatizar nenhum processo em nome dele.
Explique isso com clareza e empatia: "Preciso dessa autorização para conseguir trabalhar no seu CNPJ com segurança, sem precisar da sua senha."

Se o cliente recusar fazer a procuração agora:
- Explique o motivo de forma simples e empática
- Ofereça simular valores com base nas informações que ele tem (meses de DAS em aberto, etc.)
- Se ele aceitar a simulação e demonstrar intenção de contratar, chame 'agendar_reuniao_fechamento'
- Se ele recusar a procuração E a simulação: marque red_flag(PROCURACAO_RECUSADA) e encerre com educação

### Qualificação (BANT)
Colete de forma conversacional, nunca em lista:
- **Necessidade:** Qual o problema? (dívidas, notas, organização, abertura)
- **Urgência:** Tem prazo ou pressão? (notificação da Receita, DAS atrasado, multa)
- **Capacidade:** Faturamento mensal aproximado

Classificação:
- **SQL** (BANT confirmado): dor declarada + urgência + faturamento compatível → 'agendar_reuniao_fechamento'
- **MQL**: tem interesse mas falta urgência ou orçamento → continue coletando, use 'enviar_link_reuniao' ao concluir
- **DESQUALIFICADO**: faturamento ≤ R$5k/mês E sem dívida E sem plano de crescimento → update_user(situacao=desqualificado)

Ao qualificar: update_user com qualificacao + motivo_qualificacao (TAG: RESGATE_URGENTE | PARCEIRO_DE_CRESCIMENTO | NUTRICAO) + observacoes com resumo BANT completo para o Haylander.

### Reuniões
- 'enviar_link_reuniao' → consulta simples, sem urgência definida
- 'agendar_reuniao_fechamento' → lead SQL confirmado, urgência presente, pronto para proposta. Notifica o Haylander com urgência.
`;

export const getComercialTools = (context: AgentContext): ToolDefinition[] => [
    {
        name: 'enviar_apresentacao_comercial',
        description: 'Envia a apresentação comercial (PDF) para o cliente. Use na primeira mensagem, após a saudação.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            const { sendCommercialPresentation } = await import('../../server-tools');
            return sendCommercialPresentation(context.userPhone, 'apc');
        }
    },
    {
        name: 'enviar_link_reuniao',
        description: 'Envia link de agendamento para consulta simples (lead MQL, sem urgência definida). Para lead SQL com urgência, use agendar_reuniao_fechamento.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            await updateUser({ telefone: context.userPhone, status_atendimento: 'reuniao_pendente' });
            return sendMeetingForm(context.userPhone);
        }
    },
    {
        name: 'agendar_reuniao_fechamento',
        description: 'Use quando o lead é SQL: dor declarada + urgência + capacidade financeira confirmadas. Envia o link de reunião E notifica o Haylander com urgência incluindo o resumo do lead.',
        parameters: {
            type: 'object',
            properties: {
                resumo: { type: 'string', description: 'Resumo BANT completo: problema, urgência, faturamento, TAG, o que já foi discutido.' }
            },
            required: ['resumo']
        },
        function: async (args: any) => {
            await updateUser({ telefone: context.userPhone, status_atendimento: 'reuniao_fechamento' });
            const [meetingResult] = await Promise.all([
                sendMeetingForm(context.userPhone),
                callAttendant(
                    context.userPhone,
                    `🔴 REUNIÃO DE FECHAMENTO AGENDADA\n\nLead: ${context.userPhone}\n\n${args.resumo}\n\nAção: Confirme disponibilidade e entre na chamada preparado para fechar.`
                )
            ]);
            return meetingResult;
        }
    },
    {
        name: 'consultar_cnpj_publico',
        description: 'Use IMEDIATAMENTE quando o cliente informar um CNPJ. Busca dados públicos (BrasilAPI), detecta se é MEI, preenche a ficha automaticamente e valida se a procuração e-CAC está ativa no Serpro.',
        parameters: {
            type: 'object',
            properties: { cnpj: { type: 'string', description: 'CNPJ informado pelo cliente.' } },
            required: ['cnpj']
        },
        function: async (args: any) => consultarCnpjPublico(args.cnpj, context.userPhone)
    },
];
