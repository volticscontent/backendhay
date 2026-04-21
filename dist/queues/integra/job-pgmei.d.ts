import { Queue, Worker } from 'bullmq';
export declare const pgmeiQueue: Queue<any, any, string, any, any, string>;
export declare function startPgmeiWorker(): Worker<any, any, string>;
export declare function enqueueRoboPgmei(execucaoId: number): Promise<void>;
//# sourceMappingURL=job-pgmei.d.ts.map