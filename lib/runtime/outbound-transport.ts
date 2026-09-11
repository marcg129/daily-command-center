export interface OutboundTextResponse {
  text: string;
  contentType: string;
  finalUrl: string;
}

export interface OutboundTransport {
  readText(url: string, options?: { timeoutMs?: number; maxBytes?: number; headers?: HeadersInit }): Promise<OutboundTextResponse>;
}
