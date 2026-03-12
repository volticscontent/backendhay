"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFilesFromR2 = listFilesFromR2;
exports.uploadFileToR2 = uploadFileToR2;
exports.getPresignedUploadUrl = getPresignedUploadUrl;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const logger_1 = require("./logger");
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    logger_1.r2Logger.warn('Credenciais R2 não totalmente configuradas');
}
const r2 = new client_s3_1.S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
});
async function listFilesFromR2(prefix) {
    if (!R2_BUCKET_NAME)
        throw new Error('R2_BUCKET_NAME não configurado');
    const command = new client_s3_1.ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
    });
    try {
        const response = await r2.send(command);
        if (!response.Contents)
            return [];
        return response.Contents.map(item => {
            const fileName = item.Key || '';
            const publicUrl = R2_PUBLIC_URL
                ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${fileName}`
                : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${fileName}`;
            return {
                key: fileName,
                url: publicUrl,
                size: item.Size || 0,
                lastModified: item.LastModified || new Date(),
            };
        });
    }
    catch (error) {
        logger_1.r2Logger.error('Erro ao listar arquivos:', error);
        return [];
    }
}
async function uploadFileToR2(fileBuffer, fileName, contentType) {
    if (!R2_BUCKET_NAME)
        throw new Error('R2_BUCKET_NAME não configurado');
    const command = new client_s3_1.PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: contentType,
    });
    await r2.send(command);
    const publicUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${fileName}`
        : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${fileName}`;
    return publicUrl;
}
async function getPresignedUploadUrl(fileName, contentType) {
    if (!R2_BUCKET_NAME)
        throw new Error('R2_BUCKET_NAME não configurado');
    const command = new client_s3_1.PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        ContentType: contentType,
    });
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(r2, command, { expiresIn: 3600 });
    const publicUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${fileName}`
        : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${fileName}`;
    return { uploadUrl, publicUrl };
}
//# sourceMappingURL=r2.js.map