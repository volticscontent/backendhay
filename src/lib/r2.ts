import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.warn('[R2] Credenciais R2 não totalmente configuradas');
}

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || '',
        secretAccessKey: R2_SECRET_ACCESS_KEY || '',
    },
});

export async function listFilesFromR2(prefix?: string): Promise<{ key: string; url: string; size: number; lastModified: Date }[]> {
    if (!R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME não configurado');

    const command = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
    });

    try {
        const response = await r2.send(command);
        if (!response.Contents) return [];

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
    } catch (error) {
        console.error('[R2] Erro ao listar arquivos:', error);
        return [];
    }
}

export async function uploadFileToR2(
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    contentType: string
): Promise<string> {
    if (!R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME não configurado');

    const command = new PutObjectCommand({
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

export async function getPresignedUploadUrl(fileName: string, contentType: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    if (!R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME não configurado');

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
    const publicUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${fileName}`
        : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${fileName}`;

    return { uploadUrl, publicUrl };
}
