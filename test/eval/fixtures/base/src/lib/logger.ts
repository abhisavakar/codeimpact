export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry = { timestamp: new Date().toISOString(), level, message, ...context };
  console.log(JSON.stringify(entry));
}
