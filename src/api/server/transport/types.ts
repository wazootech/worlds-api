/** Tunable HTTP edge behavior for `/rpc` (CORS, body cap, rate limiting). */
export type TransportConfig = {
  rpcBodyLimitBytes: number;
  corsOrigin: string | string[];
  corsAllowCredentials: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
};
