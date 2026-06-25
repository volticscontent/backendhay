"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PGFN_WINDOW = void 0;
exports.isPgfnWindowOpen = isPgfnWindowOpen;
exports.minutesUntilPgfnOpen = minutesUntilPgfnOpen;
exports.getPgfnToken = getPgfnToken;
exports.consultarDividaAtivaPorDevedor = consultarDividaAtivaPorDevedor;
exports.consultarDividaAtivaPorInscricao = consultarDividaAtivaPorInscricao;
const node_https_1 = __importDefault(require("node:https"));
const node_querystring_1 = __importDefault(require("node:querystring"));
const logger_1 = require("./logger");
// Janela de funcionamento da API REST de Dívida Ativa da PGFN (horário de Brasília).
// Confirmado ao vivo: fora dela a API devolve 403 "Serviço REST disponível entre 07:05 e 22:00 horas".
exports.PGFN_WINDOW = { openLabel: '07:05', closeLabel: '22:00' };
const PGFN_OPEN_MIN = 7 * 60 + 5; // 07:05
const PGFN_CLOSE_MIN = 22 * 60; // 22:00
/** Minuto-do-dia atual no fuso de São Paulo (robusto a qualquer timezone do servidor). */
function saoPauloMinuteOfDay(now = new Date()) {
    const sp = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return sp.getHours() * 60 + sp.getMinutes();
}
/** True se a API da PGFN está na janela de funcionamento agora. */
function isPgfnWindowOpen(now = new Date()) {
    const m = saoPauloMinuteOfDay(now);
    return m >= PGFN_OPEN_MIN && m < PGFN_CLOSE_MIN;
}
/** Minutos até a próxima abertura da janela (0 se já aberta). */
function minutesUntilPgfnOpen(now = new Date()) {
    const m = saoPauloMinuteOfDay(now);
    if (m < PGFN_OPEN_MIN)
        return PGFN_OPEN_MIN - m; // ainda hoje
    if (m >= PGFN_CLOSE_MIN)
        return (24 * 60 - m) + PGFN_OPEN_MIN; // amanhã
    return 0; // aberta agora
}
/** Detecta a resposta 403 de fora-de-horário da API de Dívida Ativa. */
function isOffHoursError(message) {
    return /HTTP\s*403/.test(message) && /(dispon[íi]vel\s+entre|07:05)/i.test(message);
}
const PGFN_TOKEN_URL = process.env.PGFN_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
const PGFN_BASE_URL = (process.env.PGFN_BASE_URL || 'https://gateway.apiserpro.serpro.gov.br/consulta-divida-ativa-df/api').replace(/\/$/, '');
const PGFN_CLIENT_ID = process.env.PGFN_CLIENT_ID;
const PGFN_CLIENT_SECRET = process.env.PGFN_CLIENT_SECRET;
let cachedPgfnToken = null;
const onlyDigits = (value) => value.replace(/\D/g, '');
function pgfnRequest(urlStr, options, body, retries = 2) {
    const execute = () => new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const req = node_https_1.default.request({
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
                        }
                        catch {
                            resolve(data || null);
                        }
                        return;
                    }
                    let message = `PGFN HTTP ${res.statusCode}`;
                    try {
                        const parsed = JSON.parse(data);
                        const detalhes = parsed.message || parsed.error_description || parsed.error || parsed.descricao || data;
                        message += `: ${String(detalhes).slice(0, 1000)}`;
                    }
                    catch {
                        message += `: ${data.slice(0, 1000)}`;
                    }
                    reject(new Error(message));
                });
            });
            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error(`PGFN timeout após 30s: ${urlStr}`)));
            if (body)
                req.write(body);
            req.end();
        }
        catch (error) {
            reject(error);
        }
    });
    // Retry com backoff em 5xx e timeout. A API de Dívida Ativa tem instabilidade transitória;
    // sem retry, qualquer 502/503/timeout pontual virava 'INCONCLUSIVO' no fluxo do Apolo (e o
    // LLM inventava explicações falsas ao cliente). 401/404 NÃO são retentados aqui — são tratados
    // em consultarPgfn (refresh de token / devedor inexistente).
    const attempt = async (left) => {
        try {
            return await execute();
        }
        catch (error) {
            const msg = String(error instanceof Error ? error.message : error);
            const isRetryable = /PGFN HTTP 5\d\d/.test(msg) || msg.includes('timeout');
            if (left > 0 && isRetryable) {
                logger_1.serproLogger.warn(`PGFN: erro transitório, retry (${left} restante(s)): ${msg}`);
                await new Promise(r => setTimeout(r, 1000 * (retries - left + 1)));
                return attempt(left - 1);
            }
            throw error;
        }
    };
    return attempt(retries);
}
async function getPgfnToken(forceRefresh = false) {
    const now = Date.now();
    if (cachedPgfnToken && !forceRefresh && now < cachedPgfnToken.expiresAt)
        return cachedPgfnToken;
    if (!PGFN_CLIENT_ID || !PGFN_CLIENT_SECRET) {
        throw new Error('Credenciais PGFN ausentes. Configure PGFN_CLIENT_ID e PGFN_CLIENT_SECRET no bot-backend/.env');
    }
    const authHeader = `Basic ${Buffer.from(`${PGFN_CLIENT_ID}:${PGFN_CLIENT_SECRET}`).toString('base64')}`;
    const postData = node_querystring_1.default.stringify({ grant_type: 'client_credentials' });
    const response = await pgfnRequest(PGFN_TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
        },
    }, postData);
    if (!response.access_token)
        throw new Error('Falha ao recuperar token da API PGFN');
    const expiresIn = Number(response.expires_in || 3300);
    cachedPgfnToken = {
        token_type: response.token_type || 'Bearer',
        access_token: response.access_token,
        expires_in: expiresIn,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
    };
    logger_1.serproLogger.info(`Token PGFN renovado. Expira em: ${new Date(cachedPgfnToken.expiresAt).toISOString()}`);
    return cachedPgfnToken;
}
function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .trim();
}
function toStringOrNull(value) {
    if (value === null || value === undefined || value === '')
        return null;
    return String(value);
}
function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}
function formatMoney(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
function extrairMensagensPgfn(data) {
    if (!data || typeof data !== 'object')
        return [];
    const obj = data;
    const mensagens = obj.mensagens || obj.messages || obj.erros || obj.errors;
    if (!Array.isArray(mensagens))
        return [];
    return mensagens.map(item => {
        if (!item || typeof item !== 'object')
            return String(item);
        const msg = item;
        return String(msg.texto || msg.message || msg.descricao || msg.codigo || JSON.stringify(msg));
    }).filter(Boolean);
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function collectRecords(value, output = []) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectRecords(item, output);
        return output;
    }
    const record = asRecord(value);
    if (!record)
        return output;
    const hasInscricao = ['numeroInscricao', 'numero_inscricao', 'inscricao', 'numeroDaInscricao'].some(key => record[key]);
    const hasValor = ['valorTotalConsolidadoMoeda', 'valorTotalConsolidado', 'valorConsolidado', 'valor'].some(key => record[key]);
    const hasSituacao = ['situacaoDescricao', 'situacao', 'tipoRegularidade', 'situacaoInscricao'].some(key => record[key]);
    if (hasInscricao || (hasValor && hasSituacao))
        output.push(record);
    for (const key of ['inscricoes', 'dividas', 'debitos', 'resultado', 'items', 'content', 'dados', 'lista']) {
        if (record[key])
            collectRecords(record[key], output);
    }
    return output;
}
function normalizeInscricao(record) {
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
function buildPgfnResumo(data, mensagens) {
    const inscricoes = collectRecords(data).map(normalizeInscricao);
    const uniqueInscricoes = Array.from(new Map(inscricoes.map((item, index) => [item.numeroInscricao || `idx-${index}`, item])).values());
    const valorTotal = uniqueInscricoes.reduce((sum, item) => sum + (item.valorTotalConsolidado || 0), 0);
    const situacoes = Array.from(new Set(uniqueInscricoes.map(i => i.situacaoDescricao).filter((v) => Boolean(v))));
    const regularidades = Array.from(new Set(uniqueInscricoes.map(i => i.tipoRegularidade).filter((v) => Boolean(v))));
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
function detectarDebitoPgfn(data, resumo) {
    if (resumo.total_inscricoes > 0)
        return true;
    const texto = JSON.stringify(data)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    const SEM_DEBITO_PATTERNS = [
        'NAO HA DEBITOS', 'NADA CONSTA', 'SEM DEBITO', 'SEM DEBITOS',
        'NAO FORAM ENCONTRAD', 'NENHUMA INSCRICAO', 'DEVEDOR NAO LOCALIZADO',
        'NAO LOCALIZADO', 'SEM INSCRICAO', 'NENHUM REGISTRO',
        'NAO EXISTE INSCRICAO', 'NAO EXISTEM INSCRICOES'
    ];
    if (SEM_DEBITO_PATTERNS.some(s => texto.includes(s)))
        return false;
    if (['INSCRICAO', 'DIVIDA ATIVA', 'DEVEDOR', 'DEBITO', 'AJUIZADA', 'EXIGIVEL'].some(s => texto.includes(s)))
        return true;
    // Se não há inscrições e nenhum pattern de débito ativo foi encontrado,
    // considerar como sem débito (evita falso 'inconclusivo')
    if (resumo.total_inscricoes === 0)
        return false;
    return null;
}
async function consultarPgfn(path, consulta, parametro, forceRefresh = false) {
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
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (!forceRefresh && message.includes('401'))
            return consultarPgfn(path, consulta, parametro, true);
        // PGFN fora do horário (07:05–22:00) = estado esperado, NÃO erro. Devolve flag para
        // o fluxo reagendar a consulta dentro da janela em vez de tratar como falha.
        if (isOffHoursError(message)) {
            return {
                status: 'success',
                origem: 'pgfn_api',
                consulta,
                parametro,
                dados: null,
                tem_debitos_detectado: null,
                fora_de_horario: true,
                mensagens_pgfn: [`Consulta à Dívida Ativa (PGFN) disponível das ${exports.PGFN_WINDOW.openLabel} às ${exports.PGFN_WINDOW.closeLabel}.`],
                resumo: buildPgfnResumo(null, []),
            };
        }
        // PGFN 404 = devedor não encontrado = sem dívida ativa inscrita
        if (message.includes('404')) {
            const emptyResumo = buildPgfnResumo(null, []);
            return {
                status: 'success',
                origem: 'pgfn_api',
                consulta,
                parametro,
                dados: null,
                tem_debitos_detectado: false,
                mensagens_pgfn: ['Devedor não localizado na base da PGFN (HTTP 404).'],
                resumo: emptyResumo,
            };
        }
        throw error;
    }
}
async function consultarDividaAtivaPorDevedor(cpfOuCnpj) {
    const documento = onlyDigits(cpfOuCnpj);
    if (![11, 14].includes(documento.length))
        throw new Error('Documento inválido para PGFN. Envie CPF ou CNPJ com 11 ou 14 dígitos.');
    return consultarPgfn(`/v1/devedor/${documento}`, 'devedor', documento);
}
async function consultarDividaAtivaPorInscricao(numeroInscricao) {
    const inscricao = onlyDigits(numeroInscricao);
    if (!inscricao)
        throw new Error('Número de inscrição PGFN inválido.');
    return consultarPgfn(`/v1/inscricao/${inscricao}`, 'inscricao', inscricao);
}
//# sourceMappingURL=pgfn.js.map