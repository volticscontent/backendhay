import { AgentContext } from './types';
import { ToolDefinition } from './openai-client';
import {
    getUser, getAvailableMedia, contextRetrieve, sendMedia,
    updateUser, callAttendant, interpreter, setAgentRouting,
    getUpdatableFields, getClientDataWithFreshness
} from './server-tools';
import { getDynamicContext } from './knowledge-base';
import { agentLogger } from '../lib/logger';
import redis from '../lib/redis';

export interface SharedAgentContext {
    userData: string;
    mediaList: string;
    dynamicContext: string;
    attendantWarning: string;
    outOfHoursWarning: string;
    currentDate: string;
}

export async function prepareAgentContext(context: AgentContext): Promise<SharedAgentContext> {
    let userDataJson = "{}";
    try {
        userDataJson = await getUser(context.userPhone);
    } catch (error) {
        agentLogger.warn("Error fetching user data:", error);
    }

    let userData = "Não encontrado";
    try {
        const parsed = JSON.parse(userDataJson);
        if (parsed.status !== 'error' && parsed.status !== 'not_found') {
            const allowedKeys = [
                'telefone', 'nome_completo', 'email', 'situacao', 'qualificacao',
                'observacoes', 'faturamento_mensal', 'tem_divida', 'tipo_negocio',
                'possui_socio', 'sexo', 'cnpj', 'cnpj_ativo', 'cnpjs_adicionais',
                'razao_social', 'tipo_divida', 'valor_divida_federal'
            ];
            userData = Object.entries(parsed)
                .filter(([k]) => allowedKeys.includes(k))
                .map(([k, v]) => `${k} = ${v}`)
                .join('\n');
        }
    } catch { }

    let mediaList = "Nenhuma mídia disponível.";
    let dynamicContext = "";
    try {
        [mediaList, dynamicContext] = await Promise.all([getAvailableMedia(), getDynamicContext()]);
    } catch (e) {
        agentLogger.warn("Error fetching media/context:", e);
    }

    // Inject proactive context sent by the frontend (e.g., "client attended meeting")
    try {
        const frontendCtxRaw = await redis.get(`bot_context:${context.userPhone}`);
        if (frontendCtxRaw) {
            const frontendCtx = JSON.parse(frontendCtxRaw);
            const lines = Object.entries(frontendCtx)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
            dynamicContext += `\n\n[CONTEXTO DO PAINEL ADMIN]\n${lines}`;
        }
    } catch (e) {
        agentLogger.warn("Error loading frontend context from Redis:", e);
    }

    const attendantWarning = context.attendantRequestedReason
        ? `\n[ATENÇÃO: ATENDENTE HUMANO SOLICITADO]\nO cliente solicitou atendimento humano pelo seguinte motivo: "${context.attendantRequestedReason}". O humano já foi notificado e responderá em breve. Enquanto o humano não chega, mantenha o diálogo e tente ir adiantando as informações ou acolhendo o cliente de forma empática avisando que a equipe humana está a caminho.\n`
        : '';

    const outOfHoursWarning = context.outOfHours
        ? `\n[ATENÇÃO: HUMANO INDISPONÍVEL]\nNeste exato momento, o time humano da Haylander Martins Contabilidade está fora do horário comercial. VOCÊ deve continuar o atendimento normalmente. Avisar o cliente de forma amigável que o time humano responderá assim que retornar, mas que você pode adiantar o caso agora.\n`
        : '';

    const currentDate = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    return { userData, mediaList, dynamicContext, attendantWarning, outOfHoursWarning, currentDate };
}

export function getSharedTools(context: AgentContext): ToolDefinition[] {
    return [
        {
            name: 'context_retrieve',
            description: 'Buscar o contexto recente da conversa do cliente (Evolution API).',
            parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Quantidade de mensagens a buscar (padrão 30).' } } },
            function: async (args) => await contextRetrieve(context.userId, typeof args.limit === 'number' ? args.limit : 30)
        },
        {
            name: 'enviar_midia',
            description: 'Enviar um arquivo de mídia (PDF, Vídeo, Áudio).',
            parameters: { type: 'object', properties: { key: { type: 'string', description: 'A chave (ID) do arquivo de mídia.' } }, required: ['key'] },
            function: async (args) => await sendMedia(context.userPhone, args.key as string)
        },
        {
            name: 'update_user',
            description: `Atualizar dados do lead no banco. Use sempre que coletar uma informação nova ou mudar o estágio do lead.

QUANDO QUALIFICAR (MQL ou SQL): preencha qualificacao + motivo_qualificacao (TAG obrigatória: RESGATE_URGENTE | GESTAO_E_CRESCIMENTO | NUTRICAO) + observacoes com resumo BANT completo.
QUANDO DESQUALIFICAR: situacao=desqualificado + motivo_qualificacao explicando o motivo.
QUANDO RED-FLAG: situacao=red_flag + motivo_qualificacao com o tipo (PROCURACAO_RECUSADA | SUMIU_POS_PROCURACAO | SUMIU_POS_PROPOSTA | PRECO_RECUSADO). Red-flag NÃO encerra o lead — marca para follow-up humano.`,
            parameters: {
                type: 'object',
                properties: {
                    situacao: { type: 'string', enum: ['nao_respondido', 'desqualificado', 'qualificado', 'cliente', 'atendimento_humano', 'red_flag', 'Ativo'] },
                    qualificacao: { type: 'string', enum: ['ICP', 'MQL', 'SQL'] },
                    motivo_qualificacao: {
                        type: 'string',
                        description: 'TAG de abordagem ao qualificar (RESGATE_URGENTE | GESTAO_E_CRESCIMENTO | NUTRICAO), tipo de red-flag, ou motivo de desqualificação. Sempre preenchido.'
                    },
                    observacoes: { type: 'string', description: 'Resumo BANT para o Haylander: necessidade declarada, urgência, capacidade de pagamento, próximo passo.' },
                    faturamento_mensal: { type: 'string' },
                    tipo_negocio: { type: 'string' },
                    tem_divida: { type: 'boolean' },
                    tipo_divida: { type: 'string' },
                    valor_divida_federal: { type: 'string' },
                    possui_socio: { type: 'boolean' },
                    cpf: { type: 'string' },
                    cnpj: { type: 'string', description: 'CNPJ principal do cliente (substitui o existente). Para ADICIONAR uma segunda empresa sem sobrescrever, use cnpj_adicionar.' },
                    cnpj_adicionar: { type: 'string', description: 'Adiciona um CNPJ extra à lista de empresas do cliente sem sobrescrever o CNPJ principal. Use quando o cliente tiver mais de uma empresa.' },
                    cnpj_ativo: { type: 'string', description: 'Define qual CNPJ está sendo consultado/operado agora. Mude este campo quando o cliente quiser operar sobre uma empresa específica (útil para clientes com múltiplos CNPJs).' },
                    razao_social: { type: 'string' },
                    email: { type: 'string' },
                    nome_completo: { type: 'string' },
                    sexo: { type: 'string' }
                },
                additionalProperties: true
            },
            function: async (args: Record<string, unknown>) => {
                const result = await updateUser({ telefone: context.userPhone, ...args });
                if (args.qualificacao) {
                    await setAgentRouting(context.userPhone, 'vendedor');
                    agentLogger.info(`🔀 Roteamento ativado: ${context.userPhone} → Vendedor (qualificação: ${args.qualificacao})`);
                }
                if (args.situacao === 'red_flag') {
                    const tipo = (args.motivo_qualificacao as string) || 'não especificado';
                    const reason = `🚩 RED-FLAG detectado\nLead: ${context.userPhone}\nTipo: ${tipo}\nAção: follow-up humano necessário`;
                    await callAttendant(context.userPhone, reason);
                    agentLogger.warn(`🚩 Red-flag marcado: ${context.userPhone} — ${tipo}`);
                }
                return result;
            }
        },
        {
            name: 'listar_tabelas_e_campos',
            description: 'Retorna a lista completa de todas as tabelas e os campos que você tem permissão para atualizar usando a ferramenta update_user. Use isto se quiser saber exatamente quais variáveis pode enviar e atualizar.',
            parameters: { type: 'object', properties: {} },
            function: async () => await getUpdatableFields()
        },
        {
            name: 'chamar_atendente',
            description: 'Transferir o atendimento para um atendente humano. Forneça um resumo detalhado da necessidade no campo reason.',
            parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Resumo detalhado: O que o cliente quer, qual a dor dele e o que já foi conversado.' } }, required: ['reason'] },
            function: async (args) => await callAttendant(context.userPhone, args.reason as string)
        },
        {
            name: 'interpreter',
            description: 'Ferramenta de memória compartilhada (post/get).',
            parameters: { type: 'object', properties: { action: { type: 'string', enum: ['post', 'get'] }, text: { type: 'string' }, category: { type: 'string', enum: ['qualificacao', 'vendas', 'atendimento'] } }, required: ['action', 'text'] },
            function: async (args) => await interpreter(context.userPhone, args.action as 'post' | 'get', args.text as string, args.category as 'qualificacao' | 'vendas' | 'atendimento')
        },
        {
            name: 'consultar_dados_cliente',
            description: 'Retorna dados cadastrais do banco + histórico de consultas Serpro com indicador de frescor (ainda_valido). USE SEMPRE ANTES de qualquer tool Serpro para evitar consultas redundantes ao governo.',
            parameters: { type: 'object', properties: {} },
            function: async () => await getClientDataWithFreshness(context.userPhone)
        }
    ];
}
