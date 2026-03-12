import { Queue, Worker } from 'bullmq';
export declare const debounceQueue: Queue<any, any, string, any, any, string>;
interface DebounceMetadata {
    sender: string;
    pushName?: string;
    userPhone: string;
}
/**
 * Acumula mensagem no buffer Redis e (re)agenda o processamento com debounce.
 * Operações Redis são atômicas via pipeline. Protege contra buffer overflow.
 */
export declare function bufferAndDebounce(userPhone: string, message: string | Array<{
    type: string;
    text?: string;
    image_url?: {
        url: string;
    };
}>, metadata: DebounceMetadata): Promise<void>;
export declare function startDebounceWorker(): Worker;
export {};
//# sourceMappingURL=message-debounce.d.ts.map