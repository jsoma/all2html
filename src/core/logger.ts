/**
 * Pluggable logger interface for observability.
 * Default: console. Users can swap in pino, winston, or a silent no-op.
 */

export interface LogData {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  error(msg: string, data?: LogData): void;
}

export interface Span {
  set(key: string, value: unknown): void;
  end(): void;
}

export interface ObservableLogger extends Logger {
  startSpan(name: string, data?: LogData): Span;
}

/** Silent logger — discards everything */
export const noopLogger: ObservableLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  startSpan() {
    return { set() {}, end() {} };
  },
};

/** Console logger with timing spans */
export function createConsoleLogger(prefix = "all2html"): ObservableLogger {
  function fmt(level: string, msg: string, data?: LogData): string {
    const parts = [`[${prefix}] ${level}: ${msg}`];
    if (data && Object.keys(data).length > 0) {
      const entries = Object.entries(data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      parts.push(entries);
    }
    return parts.join(" ");
  }

  return {
    debug(msg, data) {
      console.debug(fmt("debug", msg, data));
    },
    info(msg, data) {
      console.info(fmt("info", msg, data));
    },
    warn(msg, data) {
      console.warn(fmt("warn", msg, data));
    },
    error(msg, data) {
      console.error(fmt("error", msg, data));
    },
    startSpan(name, data) {
      const start = performance.now();
      const attrs: LogData = { ...data };
      console.info(fmt("span:start", name, data));
      return {
        set(key, value) {
          attrs[key] = value;
        },
        end() {
          const ms = (performance.now() - start).toFixed(1);
          console.info(fmt("span:end", `${name} (${ms}ms)`, attrs));
        },
      };
    },
  };
}

/** Collect structured events for programmatic consumption */
export interface StructuredEvent {
  level: "debug" | "info" | "warn" | "error" | "span:start" | "span:end";
  msg: string;
  data?: LogData;
  timestamp: number;
  durationMs?: number;
}

export function createCollectingLogger(): ObservableLogger & {
  events: StructuredEvent[];
} {
  const events: StructuredEvent[] = [];

  function emit(level: StructuredEvent["level"], msg: string, data?: LogData, durationMs?: number) {
    events.push({ level, msg, data, timestamp: Date.now(), durationMs });
  }

  return {
    events,
    debug(msg, data) {
      emit("debug", msg, data);
    },
    info(msg, data) {
      emit("info", msg, data);
    },
    warn(msg, data) {
      emit("warn", msg, data);
    },
    error(msg, data) {
      emit("error", msg, data);
    },
    startSpan(name, data) {
      const start = Date.now();
      const attrs: LogData = { ...data };
      emit("span:start", name, data);
      return {
        set(key, value) {
          attrs[key] = value;
        },
        end() {
          const ms = Date.now() - start;
          emit("span:end", name, attrs, ms);
        },
      };
    },
  };
}
