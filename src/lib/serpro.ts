import https from 'node:https';
import querystring from 'node:querystring';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';
import { SERVICE_CONFIG, ServiceConfigItem } from './serpro-config';
import { serproLogger } from './logger';

export { SERVICE_CONFIG };

const formatPem = (key: string | undefined) => {
    if (!key) return undefined;
    return key.replace(/\\n/g, '\n');
};

const getCertContent = (contentEnv: string | undefined, pathEnv: string | undefined): string | undefined => {
    if (contentEnv) return formatPem(contentEnv);
    if (pathEnv) {
        try {
            const certPath = path.resolve(process.cwd(), pathEnv);
            if (fs.existsSync(certPath)) {
                return fs.readFileSync(certPath, 'utf8');
            }
            serproLogger.warn(`Certificado não encontrado no caminho: ${certPath}`);
        } catch (error) {
            serproLogger.error(`Erro ao ler certificado do caminho ${pathEnv}:`, error);
        }
    }
    return undefined;
};

/**
 * Extrai certificado e chave privada de um buffer PFX usando node-forge (resiliente a formatos legados)
 */
const extractPfxData = (pfxBuffer: Buffer | undefined, passphrase?: string) => {
    if (!pfxBuffer) return { cert: undefined, key: undefined };
    try {
        const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);
        
        // Extrair chave privada (pode estar em diferentes tipos de bags)
        let keyPem: string | undefined;
        const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
        if (keyBags && keyBags.length > 0 && keyBags[0].key) {
            keyPem = forge.pki.privateKeyToPem(keyBags[0].key);
        } else {
            const keyBagsAlt = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
            if (keyBagsAlt && keyBagsAlt.length > 0 && keyBagsAlt[0].key) {
                keyPem = forge.pki.privateKeyToPem(keyBagsAlt[0].key);
            }
        }

        // Extrair certificado
        let certPem: string | undefined;
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
        if (certBags && certBags.length > 0 && certBags[0].cert) {
            certPem = forge.pki.certificateToPem(certBags[0].cert);
        }

        return { cert: certPem, key: keyPem };
    } catch (error) {
        serproLogger.error('Erro ao extrair dados do PFX com node-forge:', error);
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
const SERPRO_PFX_BUFFER = (SERPRO_CERT_PFX_PATH && fs.existsSync(SERPRO_CERT_PFX_PATH))
    ? fs.readFileSync(SERPRO_CERT_PFX_PATH)
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
};

const onlyDigits = (v: string) => v.replace(/\D/g, '');

interface SerproTokens {
    access_token: string;
    jwt_token: string;
}

export async function request(
    urlStr: string,
    options: https.RequestOptions,
    body?: string
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const reqOptions: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: options.headers,
                ...(FINAL_CERT && FINAL_KEY
                    ? { cert: FINAL_CERT, key: FINAL_KEY, passphrase: SERPRO_CERT_PASS }
                    : {}
                ),
                timeout: 30000,
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); } catch { resolve(data); }
                    } else {
                        let errorMessage = `HTTP ${res.statusCode}`;
                        try {
                            const errObj = JSON.parse(data);
                            if (errObj.mensagens && Array.isArray(errObj.mensagens)) {
                                const msgs = errObj.mensagens.map((m: { codigo: string; texto: string }) => `[${m.codigo}] ${m.texto}`).join(' | ');
                                errorMessage += `: ${msgs}`;
                            } else if (errObj.error) {
                                errorMessage += `: ${errObj.error}`;
                            } else {
                                errorMessage += `: ${data.substring(0, 1000)}`;
                            }
                        } catch {
                            errorMessage += `: ${data.substring(0, 1000)}`;
                        }
                        reject(new Error(errorMessage));
                    }
                });
            });
            req.on('error', (e) => reject(e));
            if (body) req.write(body);
            req.end();
        } catch (e) {
            reject(e);
        }
    });
}

let cachedTokens: SerproTokens | null = null;

export async function getSerproTokens(): Promise<SerproTokens> {
    if (cachedTokens) return cachedTokens;

    if (!SERPRO_CLIENT_ID || !SERPRO_CLIENT_SECRET) {
        throw new Error('Credenciais do SERPRO ausentes (ID ou SECRET)');
    }
    if (!FINAL_CERT || !FINAL_KEY) {
        throw new Error('Certificado do SERPRO ausente');
    }

    const authHeader = 'Basic ' + Buffer.from(`${SERPRO_CLIENT_ID}:${SERPRO_CLIENT_SECRET}`).toString('base64');
    const postData = querystring.stringify({ grant_type: 'client_credentials' });

    const response = await request(SERPRO_AUTHENTICATE_URL, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Role-Type': SERPRO_ROLE_TYPE,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
        },
    }, postData);

    if ((response as SerproTokens).access_token && (response as SerproTokens).jwt_token) {
        cachedTokens = {
            access_token: (response as SerproTokens).access_token,
            jwt_token: (response as SerproTokens).jwt_token,
        };
        return cachedTokens;
    }
    throw new Error('Falha ao recuperar tokens do SERPRO');
}

export interface SerproOptions {
    ano?: string;
    mes?: string;
    numeroRecibo?: string;
    codigoReceita?: string;
    categoria?: string;
}

export async function consultarServico(nomeServico: keyof typeof SERVICE_CONFIG, cnpj: string, options: SerproOptions = {}) {
    const config = SERVICE_CONFIG[nomeServico];
    if (!config) throw new Error(`Serviço ${nomeServico} não configurado`);

    const idSistema = process.env[config.env_sistema] || config.default_sistema;
    const idServico = process.env[config.env_servico] || config.default_servico;

    if (!idSistema || !idServico) {
        const missing = [];
        if (!idSistema) missing.push(config.env_sistema);
        if (!idServico) missing.push(config.env_servico);
        throw new Error(`IDs não configurados para ${nomeServico}. Variáveis ausentes: ${missing.join(', ')}`);
    }

    const tokens = await getSerproTokens();
    const cnpjNumero = onlyDigits(cnpj);
    if (cnpjNumero.length !== 14) throw new Error('CNPJ inválido: envie 14 dígitos');

    const dadosServico: Record<string, unknown> = { cnpj: cnpjNumero };

    if (['PGMEI', 'SIMEI', 'DIVIDA_ATIVA', 'PGDASD', 'DCTFWEB', 'CAIXA_POSTAL'].includes(nomeServico)) {
        if (options.ano) {
            if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD'].includes(nomeServico)) {
                dadosServico.anoCalendario = options.ano;
            } else if (nomeServico === 'DCTFWEB') {
                dadosServico.anoPA = options.ano;
            } else {
                dadosServico.ano = options.ano;
            }
        } else if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD'].includes(nomeServico)) {
            dadosServico.anoCalendario = new Date().getFullYear().toString();
        }

        if (options.mes) {
            if (nomeServico === 'PGMEI') {
                const anoParaMes = options.ano || new Date().getFullYear().toString();
                dadosServico.periodoApuracao = `${options.mes.padStart(2, '0')}${anoParaMes}`;
            } else if (nomeServico === 'DCTFWEB') {
                dadosServico.mesPA = options.mes.padStart(2, '0');
            }
        }

        if (nomeServico === 'DCTFWEB') {
            dadosServico.categoria = options.categoria || 'GERAL_MENSAL';
            if (!dadosServico.anoPA) dadosServico.anoPA = new Date().getFullYear().toString();
            delete dadosServico.cnpj;
        }

        if (nomeServico === 'CAIXA_POSTAL') {
            delete dadosServico.cnpj;
        }
    }

    if (options.numeroRecibo) dadosServico.numeroRecibo = options.numeroRecibo;
    if (options.codigoReceita) dadosServico.codigoReceita = options.codigoReceita;

    const contratanteCnpj = onlyDigits(process.env.CONTRATANTE_CNPJ || '51564549000140');

    if (['PARCELAMENTO_SN_CONSULTAR', 'PARCELAMENTO_MEI_CONSULTAR'].includes(nomeServico)) {
        for (const key in dadosServico) delete dadosServico[key];
    }

    const payload = {
        contratante: { numero: contratanteCnpj, tipo: 2 },
        autorPedidoDados: { numero: contratanteCnpj, tipo: 2 },
        contribuinte: { numero: cnpjNumero, tipo: 2 },
        pedidoDados: {
            idSistema,
            idServico,
            versaoSistema: config.versao || '1.0',
            dados: ['PARCELAMENTO_SN_CONSULTAR', 'PARCELAMENTO_MEI_CONSULTAR'].includes(nomeServico) ? '' : JSON.stringify(dadosServico),
        },
    };

    serproLogger.info(`Consultando ${nomeServico} para CNPJ ${cnpjNumero}`);

    const serviceType = config.tipo as keyof typeof INTEGRA_BASE_URLS;
    const baseUrl = INTEGRA_BASE_URLS[serviceType] || INTEGRA_BASE_URLS['Consultar'];

    return request(baseUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'jwt_token': tokens.jwt_token,
            'Content-Type': 'application/json',
        },
    }, JSON.stringify(payload));
}
