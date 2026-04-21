import { Queue, Worker } from 'bullmq';
export declare const cndQueue: Queue<any, any, string, any, any, string>;
export declare function startCndWorker(): Worker<any, any, string>;
export declare function enqueueRoboCnd(execucaoId: number): Promise<void>;
//# sourceMappingURL=job-cnd.d.ts.map