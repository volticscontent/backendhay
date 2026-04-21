"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_CONFIG = void 0;
exports.request = request;
exports.getSerproTokens = getSerproTokens;
exports.consultarServico = consultarServico;
const node_https_1 = __importDefault(require("node:https"));
const node_querystring_1 = __importDefault(require("node:querystring"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_forge_1 = __importDefault(require("node-forge"));
const serpro_config_1 = require("./serpro-config");
Object.defineProperty(exports, "SERVICE_CONFIG", { enumerable: true, get: function () { return serpro_config_1.SERVICE_CONFIG; } });
const serpro_types_1 = require("./serpro-types");
const logger_1 = require("./logger");
const formatPem = (key) => {
    if (!key)
        return undefined;
    return key.replace(/\\n/g, '\n');
};
const getCertContent = (contentEnv, pathEnv) => {
    if (contentEnv)
        return formatPem(contentEnv);
    if (pathEnv) {
        try {
            const certPath = node_path_1.default.resolve(process.cwd(), pathEnv);
            if (node_fs_1.default.existsSync(certPath)) {
                return node_fs_1.default.readFileSync(certPath, 'utf8');
            }
            logger_1.serproLogger.warn(`Certificado não encontrado no caminho: ${certPath}`);
        }
        catch (error) {
            logger_1.serproLogger.error(`Erro ao ler certificado do caminho ${pathEnv}:`, error);
        }
    }
    return undefined;
};
/**
 * Extrai certificado e chave privada de um buffer PFX usando node-forge (resiliente a formatos legados)
 */
const extractPfxData = (pfxBuffer, passphrase) => {
    if (!pfxBuffer)
        return { cert: undefined, key: undefined };
    try {
        const p12Asn1 = node_forge_1.default.asn1.fromDer(pfxBuffer.toString('binary'));
        const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);
        // Extrair chave privada (pode estar em diferentes tipos de bags)
        let keyPem;
        const keyBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag })[node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag];
        if (keyBags && keyBags.length > 0 && keyBags[0].key) {
            keyPem = node_forge_1.default.pki.privateKeyToPem(keyBags[0].key);
        }
        else {
            const keyBagsAlt = p12.getBags({ bagType: node_forge_1.default.pki.oids.keyBag })[node_forge_1.default.pki.oids.keyBag];
            if (keyBagsAlt && keyBagsAlt.length > 0 && keyBagsAlt[0].key) {
                keyPem = node_forge_1.default.pki.privateKeyToPem(keyBagsAlt[0].key);
            }
        }
        // Extrair certificado
        let certPem;
        const certBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.certBag })[node_forge_1.default.pki.oids.certBag];
        if (certBags && certBags.length > 0 && certBags[0].cert) {
            certPem = node_forge_1.default.pki.certificateToPem(certBags[0].cert);
        }
        return { cert: certPem, key: keyPem };
    }
    catch (error) {
        logger_1.serproLogger.error('Erro ao extrair dados do PFX com node-forge:', error);
        return { cert: undefined, key: undefined };
    }
};
const SERPRO_CLIENT_ID = process.env.SERPRO_CLIENT_ID;
const SERPRO_CLIENT_SECRET = process.env.SERPRO_CLIENT_SECRET;
const SERPRO_CERT_PASS = process.env.CERTIFICADO_SENHA;
const SERPRO_CERT_PEM_RAW = getCertContent(process.env.SERPRO_CERT_PEM, process.env.SERPRO_CERT_PEM_PATH);
const SERPRO_CERT_KEY_RAW = getCertContent(process.env.SERPRO_CERT_KEY, process.env.SERPRO_CERT_KEY_PATH);
const SERPRO_CERT_PFX_B64 = process.env.CERTIFICADO_BASE64 ? process.env.CERTIFICADO_BASE64.replace(/^"|"$/g, '').trim() : undefined;
const SERPRO_CERT_PFX_PATH = process.env.SERPRO_CERT_PFX_PATH;
const SERPRO_PFX_BUFFER = (SERPRO_CERT_PFX_PATH && node_fs_1.default.existsSync(SERPRO_CERT_PFX_PATH))
    ? node_fs_1.default.readFileSync(SERPRO_CERT_PFX_PATH)
    : (SERPRO_CERT_PFX_B64 ? Buffer.from(SERPRO_CERT_PFX_B64, 'base64') : undefined);
// Se tivermos PFX, extraímos os componentes para PEM para maior compatibilidade com Node.js https
const pfxExtracted = extractPfxData(SERPRO_PFX_BUFFER, SERPRO_CERT_PASS);
const FINAL_CERT = pfxExtracted.cert || SERPRO_CERT_PEM_RAW;
const FINAL_KEY = pfxExtracted.key || SERPRO_CERT_KEY_RAW;
const SERPRO_ROLE_TYPE = process.env.SERPRO_ROLE_TYPE || 'TERCEIROS';
const SERPRO_AUTHENTICATE_URL = process.env.SERPRO_AUTHENTICATE_URL || 'https://autenticacao.sapi.serpro.gov.br/authenticate';
const INTEGRA_BASE_URLS = {
    Consultar: process.env.SERPRO_INTEGRA_CONSULTAR_URL || 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar',
    Emitir: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Emitir',
    Solicitar: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Solicitar',
    Apoiar: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Apoiar',
};
const onlyDigits = (v) => v.replace(/\D/g, '');
const RETRY_SENTINEL = Symbol('retry');
async function request(urlStr, options, body, retries = 2) {
    const execute = () => new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const reqOptions = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: options.headers,
                ...(FINAL_CERT && FINAL_KEY
                    ? { cert: FINAL_CERT, key: FINAL_KEY, passphrase: SERPRO_CERT_PASS }
                    : {}),
                timeout: 30000,
            };
            const req = node_https_1.default.request(reqOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304)) {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(data || null);
                        }
                    }
                    else {
                        let errorMessage = `HTTP ${res.statusCode}`;
                        try {
                            const errObj = JSON.parse(data);
                            if (errObj.mensagens && Array.isArray(errObj.mensagens)) {
                                const msgs = errObj.mensagens.map((m) => `[${m.codigo}] ${m.texto}`).join(' | ');
                                errorMessage += `: ${msgs}`;
                            }
                            else if (errObj.error) {
                                errorMessage += `: ${errObj.error}`;
                            }
                            else {
                                errorMessage += `: ${data.substring(0, 1000)}`;
                            }
                        }
                        catch {
                            errorMessage += `: ${data.substring(0, 1000)}`;
                        }
                        // Retry on 500/502/503/504
                        if (retries > 0 && res.statusCode && res.statusCode >= 500) {
                            logger_1.serproLogger.warn(`Retrying request to ${urlStr} due to ${res.statusCode}. Retries left: ${retries}. Error: ${errorMessage}`);
                            resolve(RETRY_SENTINEL);
                        }
                        else {
                            reject(new Error(errorMessage));
                        }
                    }
                });
            });
            req.on('error', (e) => reject(e));
            if (body)
                req.write(body);
            req.end();
        }
        catch (e) {
            reject(e);
        }
    });
    for (let i = 0; i <= retries; i++) {
        const result = await execute();
        if (result !== RETRY_SENTINEL)
            return result;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
    }
    throw new Error(`Max retries reached for ${urlStr}`);
}
let cachedTokens = null;
/** Retorna o timestamp (ms) da próxima meia-noite no fuso de Brasília (UTC-3). */
function nextMidnightBRT() {
    const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3
    // Representa "agora" como se fosse UTC em BRT
    const nowAsBRT = new Date(Date.now() - BRT_OFFSET_MS);
    // Avança para meia-noite do próximo dia BRT
    nowAsBRT.setUTCHours(0, 0, 0, 0);
    nowAsBRT.setUTCDate(nowAsBRT.getUTCDate() + 1);
    // Devolve em UTC real
    return nowAsBRT.getTime() + BRT_OFFSET_MS;
}
async function getSerproTokens(forceRefresh = false) {
    const now = Date.now();
    if (cachedTokens && !forceRefresh && now < cachedTokens.expiresAt)
        return cachedTokens;
    if (!SERPRO_CLIENT_ID || !SERPRO_CLIENT_SECRET) {
        throw new Error('Credenciais do SERPRO ausentes (ID ou SECRET)');
    }
    if (!FINAL_CERT || !FINAL_KEY) {
        throw new Error('Certificado do SERPRO ausente');
    }
    const authHeader = 'Basic ' + Buffer.from(`${SERPRO_CLIENT_ID}:${SERPRO_CLIENT_SECRET}`).toString('base64');
    const postData = node_querystring_1.default.stringify({ grant_type: 'client_credentials' });
    const response = await request(SERPRO_AUTHENTICATE_URL, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Role-Type': SERPRO_ROLE_TYPE,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
        },
    }, postData);
    const raw = response;
    if (raw.access_token && raw.jwt_token) {
        cachedTokens = {
            access_token: raw.access_token,
            jwt_token: raw.jwt_token,
            expiresAt: nextMidnightBRT(),
        };
        logger_1.serproLogger.info(`Tokens Serpro renovados. Expiram em: ${new Date(cachedTokens.expiresAt).toISOString()}`);
        return cachedTokens;
    }
    throw new Error('Falha ao recuperar tokens do SERPRO');
}
async function consultarServico(nomeServico, cnpj, options = {}) {
    const config = serpro_config_1.SERVICE_CONFIG[nomeServico];
    if (!config)
        throw new Error(`Serviço ${nomeServico} não configurado`);
    const idSistema = process.env[config.env_sistema] || config.default_sistema;
    const idServico = process.env[config.env_servico] || config.default_servico;
    if (!idSistema || !idServico) {
        const missing = [];
        if (!idSistema)
            missing.push(config.env_sistema);
        if (!idServico)
            missing.push(config.env_servico);
        throw new Error(`IDs não configurados para ${nomeServico}. Variáveis ausentes: ${missing.join(', ')}`);
    }
    const tokens = await getSerproTokens();
    const cnpjNumero = onlyDigits(cnpj);
    if (cnpjNumero.length !== 14)
        throw new Error('CNPJ inválido: envie 14 dígitos');
    // Inicialização base do objeto de dados - O CNPJ já vai no cabeçalho 'contribuinte' do Integra Contador
    // Muitos serviços (como PGMEI/DIVIDAATIVA24) dão erro 400 se o CNPJ for repetido no JSON 'dados'.
    const dadosServico = {};
    // SITFIS: SOLICITARPROTOCOLO91 exige dados="" (vazio). RELATORIOSITFIS92 exige {"protocoloRelatorio":"..."}
    // CAIXA_POSTAL: exige cnpjReferencia (tratado abaixo)
    // Tratamento de parâmetros temporais (Ano/Mês/PA)
    if (options.ano) {
        if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD', 'PGFN_CONSULTAR', 'PGMEI_EXTRATO', 'PGMEI_BOLETO', 'PGMEI_ATU_BENEFICIO'].includes(nomeServico)) {
            dadosServico.anoCalendario = options.ano;
        }
        else if (nomeServico === 'DCTFWEB') {
            dadosServico.anoPA = options.ano;
        }
        else {
            dadosServico.ano = options.ano;
        }
    }
    else if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD', 'PGFN_CONSULTAR', 'DCTFWEB'].includes(nomeServico)) {
        const currentYear = new Date().getFullYear().toString();
        if (nomeServico === 'DCTFWEB')
            dadosServico.anoPA = currentYear;
        else if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD', 'PGFN_CONSULTAR', 'PGMEI_EXTRATO', 'PGMEI_BOLETO', 'PGMEI_ATU_BENEFICIO'].includes(nomeServico))
            dadosServico.anoCalendario = currentYear;
        else
            dadosServico.ano = currentYear;
    }
    if (options.mes) {
        const mesPad = options.mes.padStart(2, '0');
        const anoParaMes = options.ano || new Date().getFullYear().toString();
        if (nomeServico === 'DCTFWEB') {
            dadosServico.mesPA = mesPad;
        }
        else if (['PGMEI_EXTRATO', 'PGMEI_BOLETO'].includes(nomeServico)) {
            // Serpro exige formato YYYYMM
            dadosServico.periodoApuracao = `${anoParaMes}${mesPad}`;
        }
    }
    // Exceções e Campos Específicos por Serviço
    if (nomeServico === 'DCTFWEB') {
        dadosServico.categoria = options.categoria || 'GERAL_MENSAL';
    }
    if (nomeServico === 'CAIXA_POSTAL') {
        // Doc exige cnpjReferencia e NÃO aceita campo cnpj simples em muitas versões
        // E 2024/2025: campo 'ano' gera erro se presente.
        delete dadosServico.cnpj;
        delete dadosServico.ano;
        dadosServico.cnpjReferencia = cnpjNumero;
    }
    if (options.numeroDas) {
        dadosServico.numeroDas = options.numeroDas; // Obrigatório para PGDASD CONSEXTRATO16
    }
    if (options.numeroRecibo)
        dadosServico.numeroRecibo = options.numeroRecibo;
    if (options.codigoReceita)
        dadosServico.codigoReceita = options.codigoReceita;
    // Parcela para emissão — formato YYYYMM obrigatório (ex: "202601")
    if (['PARCELAMENTO_SN_EMITIR', 'PARCELAMENTO_MEI_EMITIR'].includes(nomeServico)) {
        if (options.parcelaParaEmitir) {
            dadosServico.parcelaParaEmitir = options.parcelaParaEmitir;
        }
        else if (options.mes && options.ano) {
            dadosServico.parcelaParaEmitir = `${options.ano}${options.mes.padStart(2, '0')}`;
        }
        else {
            const now = new Date();
            dadosServico.parcelaParaEmitir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
    }
    const contratanteCnpj = onlyDigits(process.env.CONTRATANTE_CNPJ || process.env.SERPRO_CNPJ_BASE || '51564549000140');
    const isParcelamentoConsulta = ['PARCELAMENTO_SN_CONSULTAR', 'PARCELAMENTO_MEI_CONSULTAR'].includes(nomeServico);
    // Serviços que usam CPF do empresário como contribuinte
    const isSitfis = ['SIT_FISCAL_SOLICITAR', 'SIT_FISCAL_RELATORIO', 'CND'].includes(nomeServico);
    const isProcuracao = nomeServico === 'PROCURACAO';
    const cpfNumero = options.cpf ? onlyDigits(options.cpf) : undefined;
    const contribuinteNumero = ((isSitfis || isProcuracao) && cpfNumero) ? cpfNumero : cnpjNumero;
    const contribuinteTipo = ((isSitfis || isProcuracao) && cpfNumero && cpfNumero.length === 11)
        ? serpro_types_1.TipoContribuinte.CPF
        : serpro_types_1.TipoContribuinte.CNPJ;
    // Montar campo 'dados' por tipo de serviço
    let dadosField;
    if (nomeServico === 'SIT_FISCAL_SOLICITAR') {
        dadosField = '';
    }
    else if (nomeServico === 'SIT_FISCAL_RELATORIO' || nomeServico === 'CND') {
        if (!options.protocoloRelatorio)
            throw new Error('SIT_FISCAL_RELATORIO exige options.protocoloRelatorio');
        dadosField = JSON.stringify({ protocoloRelatorio: options.protocoloRelatorio });
    }
    else if (isProcuracao) {
        // OBTERPROCURACAO41: outorgante = CNPJ da empresa cliente, outorgado = CNPJ do contador
        dadosField = JSON.stringify({
            outorgante: cnpjNumero,
            tipoOutorgante: '2',
            outorgado: contratanteCnpj,
            tipoOutorgado: '2',
        });
    }
    else if (isParcelamentoConsulta) {
        dadosField = '';
    }
    else {
        dadosField = JSON.stringify(dadosServico);
    }
    const contratante = { numero: contratanteCnpj, tipo: serpro_types_1.TipoContribuinte.CNPJ };
    const payload = {
        contratante,
        autorPedidoDados: contratante,
        contribuinte: { numero: contribuinteNumero, tipo: contribuinteTipo },
        pedidoDados: {
            idSistema,
            idServico,
            versaoSistema: config.versaoSistema || '1.0',
            dados: dadosField,
        },
    };
    const serviceType = config.tipo;
    const baseUrl = INTEGRA_BASE_URLS[serviceType] || INTEGRA_BASE_URLS['Consultar'];
    const payloadStr = JSON.stringify(payload);
    logger_1.serproLogger.info(`Consultando ${nomeServico} para CNPJ ${cnpjNumero}`, { idSistema, idServico, payload: payloadStr });
    const firstAttempt = async () => {
        return request(baseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'jwt_token': tokens.jwt_token,
                'Content-Type': 'application/json',
            },
        }, JSON.stringify(payload));
    };
    try {
        return await firstAttempt();
    }
    catch (error) {
        if (error.message && error.message.includes('HTTP 401')) {
            logger_1.serproLogger.warn('Token expirado (401). Recarregando tokens e tentando novamente...');
            const newTokens = await getSerproTokens(true);
            return await request(baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${newTokens.access_token}`,
                    'jwt_token': newTokens.jwt_token,
                    'Content-Type': 'application/json',
                },
            }, JSON.stringify(payload));
        }
        throw error;
    }
}
//# sourceMappingURL=serpro.js.map