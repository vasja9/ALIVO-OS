import { LogLevel } from "./LogLevel.ts";

export type StructuredContext = Readonly<Record<string, unknown>>;

const SENSITIVE_KEY = /(?:authorization|credential|password|secret|token|api[-_]?key|private[-_]?key)/i;
const REDACTED = "[REDACTED]";

function protect(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("Structured context must not contain cycles");
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => protect(item, seen));
    seen.delete(value);
    return Object.freeze(result);
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : protect(item, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

/** Returns a detached, deeply immutable context with sensitive values removed. */
export function protectStructuredContext(context?: StructuredContext): StructuredContext | undefined {
  if (context === undefined) return undefined;
  if (context === null || Array.isArray(context) || typeof context !== "object") {
    throw new TypeError("Structured context must be an object");
  }
  return protect(context, new WeakSet<object>()) as StructuredContext;
}

export interface LogEntryProperties {
  readonly id?: string;
  readonly timestamp?: Date;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly context?: StructuredContext;
  readonly relatedOperationId?: string;
}

/** One immutable, security-filtered diagnostic record. */
export class LogEntry {
  readonly #timestampMs: number;
  readonly id: string;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly context?: StructuredContext;
  readonly relatedOperationId?: string;

  constructor(properties: LogEntryProperties) {
    if (properties.source.trim().length === 0) throw new TypeError("Log entry source must not be empty");
    if (properties.message.trim().length === 0) throw new TypeError("Log entry message must not be empty");
    this.id = properties.id ?? crypto.randomUUID();
    this.#timestampMs = properties.timestamp?.getTime() ?? Date.now();
    if (Number.isNaN(this.#timestampMs)) throw new TypeError("Log entry timestamp is invalid");
    this.level = properties.level;
    this.source = properties.source;
    this.message = properties.message;
    this.context = protectStructuredContext(properties.context);
    this.relatedOperationId = properties.relatedOperationId;
    Object.freeze(this);
  }

  get timestamp(): Date {
    return new Date(this.#timestampMs);
  }
}
