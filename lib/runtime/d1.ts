export type D1Result<T = unknown> = { results?: T[]; success: boolean; meta?: unknown };
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}
export interface D1Database { prepare(sql: string): D1PreparedStatement; batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>; }
