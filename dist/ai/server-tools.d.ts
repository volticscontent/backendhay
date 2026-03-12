export declare function getUser(phone: string): Promise<string>;
export declare function createUser(data: Record<string, unknown>): Promise<string>;
export declare function updateUser(data: Record<string, unknown>): Promise<string>;
export declare function setAgentRouting(phone: string, agent: string | null): Promise<string>;
export declare function getAgentRouting(phone: string): Promise<string | null>;
export declare function checkAvailability(dateStr: string): Promise<string>;
export declare function scheduleMeeting(phone: string, dateStr: string): Promise<string>;
export declare function tryScheduleMeeting(phone: string, dateStr: string): Promise<string>;
export declare function sendForm(phone: string, observacao: string): Promise<string>;
export declare function sendMeetingForm(phone: string): Promise<string>;
export declare function sendEnumeratedList(phone: string): Promise<string>;
export declare function callAttendant(phone: string, reason?: string): Promise<string>;
export declare function contextRetrieve(phone: string, limit?: number): Promise<string>;
export declare function searchServices(searchQuery: string): Promise<string>;
export declare function getAvailableMedia(): Promise<string>;
export declare function sendMedia(phone: string, keyOrUrl: string): Promise<string>;
export declare function sendCommercialPresentation(phone: string, type?: 'apc' | 'video'): Promise<string>;
export declare function checkCnpjSerpro(cnpj: string, service?: 'CCMEI_DADOS' | 'SIT_FISCAL'): Promise<string>;
export declare function interpreter(phone: string, action: 'post' | 'get', text: string, category?: 'qualificacao' | 'vendas' | 'atendimento'): Promise<string>;
export declare function trackResourceDelivery(leadId: number, resourceType: string, resourceKey: string, metadata?: Record<string, unknown>): Promise<void>;
export declare function checkProcuracaoStatus(leadId: number): Promise<boolean>;
export declare function markProcuracaoCompleted(leadId: number): Promise<void>;
export interface MessageSegment {
    id: string;
    content: string;
    type: 'text' | 'media' | 'link';
    delay?: number;
    metadata?: Record<string, unknown>;
}
export declare function sendMessageSegment(phone: string, segment: MessageSegment): Promise<void>;
//# sourceMappingURL=server-tools.d.ts.map