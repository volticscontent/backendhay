export interface ServiceConfigItem {
    env_sistema: string;
    env_servico: string;
    default_sistema?: string;
    default_servico?: string;
    /** Versão do serviço a ser enviada em `versaoSistema` no payload. Default: '1.0' */
    versaoSistema?: string;
    tipo: 'Consultar' | 'Emitir' | 'Solicitar' | 'Apoiar';
    descricao?: string;
    uso?: string;
    finalidade?: string;
}

export const SERVICE_CONFIG: Record<string, ServiceConfigItem> = {
    CCMEI_DADOS: {
        env_sistema: 'INTEGRA_CCMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_CCMEI_DADOS_ID_SERVICO',
        default_sistema: 'CCMEI',
        default_servico: 'DADOSCCMEI122',
        tipo: 'Consultar',
        descricao: 'Consulta dados cadastrais completos do MEI.',
    },
    PGMEI: {
        env_sistema: 'INTEGRA_PGMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_PGMEI_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'DIVIDAATIVA24',
        versaoSistema: '2.4',
        tipo: 'Consultar',
        descricao: 'Consulta dívida ativa e débitos via PGMEI (Padrão: Dívida Ativa).',
    },
    PGMEI_EXTRATO: {
        env_sistema: 'INTEGRA_PGMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_PGMEI_GERARDASPDF_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'GERARDASPDF21',
        tipo: 'Emitir',
        descricao: 'Geração de PDF do DAS (Extrato/Boleto).',
    },
    PGMEI_BOLETO: {
        env_sistema: 'INTEGRA_PGMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_PGMEI_GERARDASCODBARRA_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'GERARDASCODBARRA22',
        tipo: 'Emitir',
        descricao: 'Geração de Linha Digitável/Código de Barras do DAS.',
    },
    PGMEI_ATU_BENEFICIO: {
        env_sistema: 'INTEGRA_PGMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_PGMEI_ATUBENEFICIO_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'ATUBENEFICIO23',
        tipo: 'Emitir',
        descricao: 'Atualização de Benefícios Previdenciários no PGMEI.',
    },
    SIMEI: {
        env_sistema: 'INTEGRA_SIMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_SIMEI_ID_SERVICO',
        default_sistema: 'CCMEI',
        default_servico: 'DADOSCCMEI122',
        tipo: 'Consultar',
        descricao: 'Consulta situação do SIMEI via CCMEI.',
    },
    SIT_FISCAL_SOLICITAR: {
        env_sistema: 'INTEGRA_SITFIS_ID_SISTEMA',
        env_servico: 'INTEGRA_SITFIS_PROTOCOLO_ID_SERVICO',
        default_sistema: 'SITFIS',
        default_servico: 'SOLICITARPROTOCOLO91',
        versaoSistema: '2.0',
        tipo: 'Apoiar',
        descricao: 'Solicitação de Protocolo de Situação Fiscal.',
    },
    SIT_FISCAL_RELATORIO: {
        env_sistema: 'INTEGRA_SITFIS_ID_SISTEMA',
        env_servico: 'INTEGRA_SITFIS_RELATORIO_ID_SERVICO',
        default_sistema: 'SITFIS',
        default_servico: 'RELATORIOSITFIS92',
        versaoSistema: '2.0',
        tipo: 'Emitir',
        descricao: 'Relatório de Situação Fiscal Completa.',
    },
    // Alias de PGMEI com env vars separadas para permitir override por sistema/serviço diferente.
    // Sem override de env, chama o mesmo endpoint DIVIDAATIVA24 que PGMEI.
    DIVIDA_ATIVA: {
        env_sistema: 'INTEGRA_DIVIDA_ATIVA_ID_SISTEMA',
        env_servico: 'INTEGRA_DIVIDA_ATIVA_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'DIVIDAATIVA24',
        versaoSistema: '2.4',
        tipo: 'Consultar',
        descricao: 'Consulta de Dívida Ativa da União.',
    },
    CND: {
        env_sistema: 'INTEGRA_CND_ID_SISTEMA',
        env_servico: 'INTEGRA_CND_ID_SERVICO',
        default_sistema: 'SITFIS',
        default_servico: 'RELATORIOSITFIS92',
        versaoSistema: '2.0',
        tipo: 'Emitir',
        descricao: 'Emissão de Certidão via Relatório de Situação Fiscal.',
    },
    PARCELAMENTO_SN_EMITIR: {
        env_sistema: 'INTEGRA_PARCSN_SISTEMA',
        env_servico: 'INTEGRA_PARCSN_GERAR_SERVICO',
        default_sistema: 'PARCSN',
        default_servico: 'GERARDAS161',
        tipo: 'Emitir',
        descricao: 'Emissão de DAS de Parcelamento Simples Nacional.',
    },
    PARCELAMENTO_SN_CONSULTAR: {
        env_sistema: 'INTEGRA_PARCSN_SISTEMA',
        env_servico: 'INTEGRA_PARCSN_CONSULTAR_SERVICO',
        default_sistema: 'PARCSN',
        default_servico: 'PEDIDOSPARC163',
        tipo: 'Consultar',
        descricao: 'Consulta de Pedidos de Parcelamento Simples Nacional.',
    },
    PARCELAMENTO_MEI_EMITIR: {
        env_sistema: 'INTEGRA_PARCMEI_SISTEMA',
        env_servico: 'INTEGRA_PARCMEI_GERAR_SERVICO',
        default_sistema: 'PARCMEI',
        default_servico: 'GERARDAS201',
        tipo: 'Emitir',
        descricao: 'Emissão de DAS de Parcelamento MEI.',
    },
    PARCELAMENTO_MEI_CONSULTAR: {
        env_sistema: 'INTEGRA_PARCMEI_SISTEMA',
        env_servico: 'INTEGRA_PARCMEI_CONSULTAR_SERVICO',
        default_sistema: 'PARCMEI',
        default_servico: 'PEDIDOSPARC203',
        tipo: 'Consultar',
        descricao: 'Consulta de Pedidos de Parcelamento MEI.',
    },
    PGDASD: {
        env_sistema: 'INTEGRA_PGDASD_ID_SISTEMA',
        env_servico: 'INTEGRA_PGDASD_ID_SERVICO',
        default_sistema: 'PGDASD',
        default_servico: 'CONSEXTRATO16',
        tipo: 'Consultar',
        descricao: 'Consulta Extrato PGDAS-D.',
    },
    DASN_SIMEI: {
        env_sistema: 'INTEGRA_DASNSIMEI_ID_SISTEMA',
        env_servico: 'INTEGRA_DASNSIMEI_ID_SERVICO',
        default_sistema: 'DASNSIMEI',
        default_servico: 'CONSULTIMADECREC152',
        tipo: 'Consultar',
        descricao: 'Consulta Declaração Anual do MEI (DASN).',
    },
    DCTFWEB: {
        env_sistema: 'INTEGRA_DCTFWEB_ID_SISTEMA',
        env_servico: 'INTEGRA_DCTFWEB_ID_SERVICO',
        default_sistema: 'DCTFWEB',
        default_servico: 'CONSDECCOMPLETA33',
        tipo: 'Consultar',
        descricao: 'Consulta Declaração DCTFWeb Completa.',
    },
    PROCESSOS: {
        env_sistema: 'INTEGRA_PROCESSOS_ID_SISTEMA',
        env_servico: 'INTEGRA_PROCESSOS_ID_SERVICO',
        default_sistema: 'EPROCESSO',
        default_servico: 'CONSPROCPORINTER271',
        versaoSistema: '2.0',
        tipo: 'Consultar',
        descricao: 'Consulta de Processos Administrativos.',
    },
    CAIXA_POSTAL: {
        env_sistema: 'INTEGRA_CAIXA_POSTAL_ID_SISTEMA',
        env_servico: 'INTEGRA_CAIXA_POSTAL_ID_SERVICO',
        default_sistema: 'CAIXAPOSTAL',
        default_servico: 'MSGCONTRIBUINTE61',
        tipo: 'Consultar',
        descricao: 'Caixa Postal Eletrônica (DTE).',
    },
    PAGAMENTO: {
        env_sistema: 'INTEGRA_PAGAMENTO_ID_SISTEMA',
        env_servico: 'INTEGRA_PAGAMENTO_ID_SERVICO',
        default_sistema: 'PAGTOWEB',
        default_servico: 'COMPARRECADACAO72',
        tipo: 'Emitir',
        descricao: 'Emissão de Comprovante de Arrecadação.',
    },
    PROCURACAO: {
        env_sistema: 'INTEGRA_PROCURACAO_ID_SISTEMA',
        env_servico: 'INTEGRA_PROCURACAO_ID_SERVICO',
        default_sistema: 'PROCURACOES',
        default_servico: 'OBTERPROCURACAO41',
        versaoSistema: '1',
        tipo: 'Consultar',
        descricao: 'Consulta de Procurações Eletrônicas.',
    },
    // Alias de PGMEI sem versaoSistema:'2.4' explícita (usa '1.0' default).
    // Separado para permitir override via env INTEGRA_PGFN_* se a Serpro publicar endpoint PGFN dedicado.
    PGFN_CONSULTAR: {
        env_sistema: 'INTEGRA_PGFN_ID_SISTEMA',
        env_servico: 'INTEGRA_PGFN_CONSULTA_ID_SERVICO',
        default_sistema: 'PGMEI',
        default_servico: 'DIVIDAATIVA24',
        tipo: 'Consultar',
        descricao: 'Consulta de débitos em Dívida Ativa da União (MEI). Para geral, use SITFIS.',
    },
    // PGFN_PAEX e PGFN_SIPADE removidos: sistemas em prospecção no catálogo Serpro (IDs não publicados).
    // PAEX encerrou adesões em 2006; SIPADE é legado PGFN. Irrelevantes para perfil MEI.
};
