import https from 'node:https';
import querystring from 'node:querystring';
import { serproLogger } from './logger';

export type PgfnToken = {
    token_type: string;
    access_token: string;
    expires_in: number;
    expiresAt: number;
};

export type PgfnInscricao = {
    numeroInscricao: string | null;
    numeroProcesso: string | null;
    devedorPrincipal: string | null;
    tipoDevedor: string | null;
    situacaoDescricao: string | null;
    tipoRegularidade: string | null;
    receitaPrincipal: string | null;
    codigoReceitaPrincipal: string | null;
    dataInscricao: string | null;
    valorTotalConsolidado: number | null;
    valorTotalConsolidadoMoeda: string | null;
    ajuizada: boolean | null;
    negociada: boolean | null;
    raw: Record<string, unknown>;
};

export type PgfnResumo = {
    total_inscricoes: number;
    total_ativas: number;
    total_ajuizadas: number;
    total_negociadas: number;
    valor_total_consolidado: number;
    valor_total_consolidado_moeda: string;
    situacoes: string[];
    regularidades: string[];
    inscricoes: PgfnInscricao[];
    resumo_texto: string;
};

export type PgfnConsultaResult = {
    status: 'success';
    origem: 'pgfn_api';
    consulta: 'devedor' | 'inscricao';
    parametro: string;
    dados: unknown;
    tem_debitos_detectado: boolean | null;
    mensagens_pgfn: string[];
    resumo: PgfnResumo;
};

const PGFN_TOKEN_URL = process.env.PGFN_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
const PGFN_BASE_URL = (process.env.PGFN_BASE_URL || 'https://gateway.apiserpro.serpro.gov.br/consulta-divida-ativa-df/api').replace(/\/$/, '');
const PGFN_CLIENT_ID = process.env.PGFN_CLIENT_ID;
const PGFN_CLIENT_SECRET = process.env.PGFN_CLIENT_SECRET;

let cachedPgfnToken: PgfnToken | null = null;

const onlyDigits = (value: string) => value.replace(/\D/g, '');

function pgfnRequest(urlStr: string, options: https.RequestOptions, body?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const req = https.request({
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: options.headers,
                timeout: 30000,
            }, (res) => {
                let data = '';
                res.on('data', chunk => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            resolve(data || null);
                        }
                        return;
                    }

                    let message = `PGFN HTTP ${res.statusCode}`;
                    try {
                        const parsed = JSON.parse(data) as Record<string, unknown>;
                        const detalhes = parsed.message || parsed.error_description || parsed.error || parsed.descricao || data;
                        message += `: ${String(detalhes).slice(0, 1000)}`;
                    } catch {
                        message += `: ${data.slice(0, 1000)}`;
                    }
                    reject(new Error(message));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error(`PGFN timeout após 30s: ${urlStr}`)));
            if (body) req.write(body);
            req.end();
        } catch (error) {
            reject(error);
        }
    });
}

export async function getPgfnToken(forceRefresh = false): Promise<PgfnToken> {
    const now = Date.now();
    if (cachedPgfnToken && !forceRefresh && now < cachedPgfnToken.expiresAt) return cachedPgfnToken;

    if (!PGFN_CLIENT_ID || !PGFN_CLIENT_SECRET) {
        throw new Error('Credenciais PGFN ausentes. Configure PGFN_CLIENT_ID e PGFN_CLIENT_SECRET no bot-backend/.env');
    }

    const authHeader = `Basic ${Buffer.from(`${PGFN_CLIENT_ID}:${PGFN_CLIENT_SECRET}`).toString('base64')}`;
    const postData = querystring.stringify({ grant_type: 'client_credentials' });

    const response = await pgfnRequest(PGFN_TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
        },
    }, postData) as { token_type?: string; access_token?: string; expires_in?: number };

    if (!response.access_token) throw new Error('Falha ao recuperar token da API PGFN');

    const expiresIn = Number(response.expires_in || 3300);
    cachedPgfnToken = {
        token_type: response.token_type || 'Bearer',
        access_token: response.access_token,
        expires_in: expiresIn,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
    };

    serproLogger.info(`Token PGFN renovado. Expira em: ${new Date(cachedPgfnToken.expiresAt).toISOString()}`);
    return cachedPgfnToken;
}

function normalizeText(value: unknown): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .trim();
}

function toStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
}

function parseMoney(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function extrairMensagensPgfn(data: unknown): string[] {
    if (!data || typeof data !== 'object') return [];
    const obj = data as Record<string, unknown>;
    const mensagens = obj.mensagens || obj.messages || obj.erros || obj.errors;
    if (!Array.isArray(mensagens)) return [];
    return mensagens.map(item => {
        if (!item || typeof item !== 'object') return String(item);
        const msg = item as Record<string, unknown>;
        return String(msg.texto || msg.message || msg.descricao || msg.codigo || JSON.stringify(msg));
    }).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectRecords(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        for (const item of value) collectRecords(item, output);
        return output;
    }

    const record = asRecord(value);
    if (!record) return output;

    const hasInscricao = ['numeroInscricao', 'numero_inscricao', 'inscricao', 'numeroDaInscricao'].some(key => record[key]);
    const hasValor = ['valorTotalConsolidadoMoeda', 'valorTotalConsolidado', 'valorConsolidado', 'valor'].some(key => record[key]);
    const hasSituacao = ['situacaoDescricao', 'situacao', 'tipoRegularidade', 'situacaoInscricao'].some(key => record[key]);
    if (hasInscricao || (hasValor && hasSituacao)) output.push(record);

    for (const key of ['inscricoes', 'dividas', 'debitos', 'resultado', 'items', 'content', 'dados', 'lista']) {
        if (record[key]) collectRecords(record[key], output);
    }

    return output;
}

function normalizeInscricao(record: Record<string, unknown>): PgfnInscricao {
    const valorMoeda = toStringOrNull(record.valorTotalConsolidadoMoeda ?? record.valorConsolidadoMoeda ?? record.valorMoeda);
    const valorNumero = parseMoney(record.valorTotalConsolidado ?? record.valorConsolidado ?? record.valor ?? valorMoeda);
    const situacaoDescricao = toStringOrNull(record.situacaoDescricao ?? record.situacaoInscricao ?? record.situacao);
    const regularidade = toStringOrNull(record.tipoRegularidade ?? record.regularidade);
    const situacaoNorm = normalizeText(situacaoDescricao);

    return {
        numeroInscricao: toStringOrNull(record.numeroInscricao ?? record.numero_inscricao ?? record.inscricao ?? record.numeroDaInscricao),
        numeroProcesso: toStringOrNull(record.numeroProcesso ?? record.processo ?? record.numero_processo),
        devedorPrincipal: toStringOrNull(record.devedorPrincipal ?? record.nomeDevedor ?? record.nome ?? record.razaoSocial),
        tipoDevedor: toStringOrNull(record.tipoDevedor ?? record.tipo_devedor),
        situacaoDescricao,
        tipoRegularidade: regularidade,
        receitaPrincipal: toStringOrNull(record.receitaPrincipal ?? record.nomeReceita ?? record.receita),
        codigoReceitaPrincipal: toStringOrNull(record.codigoReceitaPrincipal ?? record.codigoReceita ?? record.codReceita),
        dataInscricao: toStringOrNull(record.dataInscricao ?? record.data_inscricao ?? record.dtInscricao),
        valorTotalConsolidado: valorNumero,
        valorTotalConsolidadoMoeda: valorMoeda ?? (valorNumero !== null ? formatMoney(valorNumero) : null),
        ajuizada: situacaoNorm ? situacaoNorm.includes('AJUIZ') : null,
        negociada: situacaoNorm ? situacaoNorm.includes('NEGOCIAD') || situacaoNorm.includes('SISPAR') : null,
        raw: record,
    };
}

function buildPgfnResumo(data: unknown, mensagens: string[]): PgfnResumo {
    const inscricoes = collectRecords(data).map(normalizeInscricao);
    const uniqueInscricoes = Array.from(
        new Map(inscricoes.map((item, index) => [item.numeroInscricao || `idx-${index}`, item])).values()
    );
    const valorTotal = uniqueInscricoes.reduce((sum, item) => sum + (item.valorTotalConsolidado || 0), 0);
    const situacoes = Array.from(new Set(uniqueInscricoes.map(i => i.situacaoDescricao).filter((v): v is string => Boolean(v))));
    const regularidades = Array.from(new Set(uniqueInscricoes.map(i => i.tipoRegularidade).filter((v): v is string => Boolean(v))));
    const totalAjuizadas = uniqueInscricoes.filter(i => i.ajuizada === true).length;
    const totalNegociadas = uniqueInscricoes.filter(i => i.negociada === true).length;
    const totalAtivas = uniqueInscricoes.filter(i => normalizeText(i.situacaoDescricao).includes('ATIVA')).length;

    const total = uniqueInscricoes.length;
    const resumoTexto = total > 0
        ? `PGFN: ${total} inscrição(ões) encontrada(s), total consolidado ${formatMoney(valorTotal)}. Situações: ${situacoes.join('; ') || 'não informadas'}.`
        : mensagens.length > 0
            ? `PGFN: nenhuma inscrição estruturada encontrada. Mensagens: ${mensagens.join(' | ')}`
            : 'PGFN: nenhuma inscrição em dívida ativa encontrada no retorno.';

    return {
        total_inscricoes: total,
        total_ativas: totalAtivas,
        total_ajuizadas: totalAjuizadas,
        total_negociadas: totalNegociadas,
        valor_total_consolidado: Number(valorTotal.toFixed(2)),
        valor_total_consolidado_moeda: formatMoney(valorTotal),
        situacoes,
        regularidades,
        inscricoes: uniqueInscricoes,
        resumo_texto: resumoTexto,
    };
}

function detectarDebitoPgfn(data: unknown, resumo: PgfnResumo): boolean | null {
    if (resumo.total_inscricoes > 0) return true;
    const texto = JSON.stringify(data)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();

    if (['NAO HA DEBITOS', 'NADA CONSTA', 'SEM DEBITO', 'SEM DEBITOS'].some(s => texto.includes(s))) return false;
    if (['INSCRICAO', 'DIVIDA ATIVA', 'DEVEDOR', 'DEBITO', 'AJUIZADA', 'EXIGIVEL'].some(s => texto.includes(s))) return true;
    return null;
}

async function consultarPgfn(path: string, consulta: 'devedor' | 'inscricao', parametro: string, forceRefresh = false): Promise<PgfnConsultaResult> {
    const token = await getPgfnToken(forceRefresh);
    const url = `${PGFN_BASE_URL}${path}`;

    try {
        const dados = await pgfnRequest(url, {
            method: 'GET',
            headers: {
                Authorization: `${token.token_type} ${token.access_token}`,
                Accept: 'application/json',
            },
        });

        const mensagens_pgfn = extrairMensagensPgfn(dados);
        const resumo = buildPgfnResumo(dados, mensagens_pgfn);

        return {
            status: 'success',
            origem: 'pgfn_api',
            consulta,
            parametro,
            dados,
            tem_debitos_detectado: detectarDebitoPgfn(dados, resumo),
            mensagens_pgfn,
            resumo,
        };
    } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (!forceRefresh && message.includes('401')) return consultarPgfn(path, consulta, parametro, true);
        throw error;
    }
}

export async function consultarDividaAtivaPorDevedor(cpfOuCnpj: string): Promise<PgfnConsultaResult> {
    const documento = onlyDigits(cpfOuCnpj);
    if (![11, 14].includes(documento.length)) throw new Error('Documento inválido para PGFN. Envie CPF ou CNPJ com 11 ou 14 dígitos.');
    return consultarPgfn(`/v1/devedor/${documento}`, 'devedor', documento);
}

export async function consultarDividaAtivaPorInscricao(numeroInscricao: string): Promise<PgfnConsultaResult> {
    const inscricao = onlyDigits(numeroInscricao);
    if (!inscricao) throw new Error('Número de inscrição PGFN inválido.');
    return consultarPgfn(`/v1/inscricao/${inscricao}`, 'inscricao', inscricao);
}
