import { Queue, Worker } from 'bullmq';
export declare const caixaPostalQueue: Queue<any, any, string, any, any, string>;
export declare function startCaixaPostalWorker(): Worker<any, any, string>;
export declare function enqueueRoboCaixaPostal(execucaoId: number): Promise<void>;
//# sourceMappingURL=job-caixa-postal.d.ts.map