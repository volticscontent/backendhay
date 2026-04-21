export declare function listFilesFromR2(prefix?: string): Promise<{
    key: string;
    url: string;
    size: number;
    lastModified: Date;
}[]>;
export declare function uploadFileToR2(fileBuffer: Buffer | Uint8Array, fileName: string, contentType: string): Promise<string>;
export declare function getPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
export declare function getPresignedUploadUrl(fileName: string, contentType: string): Promise<{
    uploadUrl: string;
    publicUrl: string;
}>;
//# sourceMappingURL=r2.d.ts.map