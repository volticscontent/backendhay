"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPgfnToken = getPgfnToken;
exports.consultarDividaAtivaPorDevedor = consultarDividaAtivaPorDevedor;
exports.consultarDividaAtivaPorInscricao = consultarDividaAtivaPorInscricao;
const node_https_1 = __importDefault(require("node:https"));
const node_querystring_1 = __importDefault(require("node:querystring"));
const logger_1 = require("./logger");
const PGFN_TOKEN_URL = process.env.PGFN_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
const PGFN_BASE_URL = (process.env.PGFN_BASE_URL || 'https://gateway.apiserpro.serpro.gov.br/consulta-divida-ativa-df/api').replace(/\/$/, '');
const PGFN_CLIENT_ID = process.env.PGFN_CLIENT_ID;
const PGFN_CLIENT_SECRET = process.env.PGFN_CLIENT_SECRET;
let cachedPgfnToken = null;
const onlyDigits = (value) => value.replace(/\D/g, '');
function pgfnRequest(urlStr, options, body) {
    return new Promise((resolve, reject) => {
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
function detectarDebitoPgfn(data) {
    if (Array.isArray(data))
        return data.length > 0;
    if (!data || typeof data !== 'object')
        return null;
    const obj = data;
    const candidatos = [
        obj.inscricoes,
        obj.dividas,
        obj.debitos,
        obj.resultado,
        obj.items,
        obj.content,
        obj.dados,
    ];
    for (const candidato of candidatos) {
        if (Array.isArray(candidato))
            return candidato.length > 0;
        if (candidato && typeof candidato === 'object') {
            const nested = detectarDebitoPgfn(candidato);
            if (nested !== null)
                return nested;
        }
    }
    const texto = JSON.stringify(obj)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    if (['NAO HA DEBITOS', 'NADA CONSTA', 'SEM DEBITO', 'SEM DEBITOS'].some(s => texto.includes(s)))
        return false;
    if (['INSCRICAO', 'DIVIDA ATIVA', 'DEVEDOR', 'DEBITO', 'AJUIZADA', 'EXIGIVEL'].some(s => texto.includes(s)))
        return true;
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
        return {
            status: 'success',
            origem: 'pgfn_api',
            consulta,
            parametro,
            dados,
            tem_debitos_detectado: detectarDebitoPgfn(dados),
            mensagens_pgfn: extrairMensagensPgfn(dados),
        };
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (!forceRefresh && message.includes('401'))
            return consultarPgfn(path, consulta, parametro, true);
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