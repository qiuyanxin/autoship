// Structured logger (SPEC Section 13.1)

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatContext(ctx: Record<string, unknown>): string {
  return Object.entries(ctx)
    .map(([k, v]) => `${k}=${v ?? "n/a"}`)
    .join(" ");
}

function log(
  level: LogLevel,
  message: string,
  ctx?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const contextStr = ctx ? " " + formatContext(ctx) : "";
  const line = `${timestamp} level=${level} ${message}${contextStr}`;
  process.stderr.write(line + "\n");
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("error", msg, ctx),
};
