import { LogEntry } from "./LogEntry.ts";
import { LogLevel } from "./LogLevel.ts";

/** In-memory internal diagnostic logger with explicit lifecycle operations. */
export class Logger {
  readonly #entries: LogEntry[] = [];

  record(entry: LogEntry): void {
    if (!(entry instanceof LogEntry)) throw new TypeError("A valid LogEntry is required");
    this.#entries.push(entry);
  }

  getEntries(): readonly LogEntry[] {
    return Object.freeze([...this.#entries]);
  }

  filterByLevel(level: LogLevel): readonly LogEntry[] {
    return Object.freeze(this.#entries.filter((entry) => entry.level === level));
  }

  filterBySource(source: string): readonly LogEntry[] {
    return Object.freeze(this.#entries.filter((entry) => entry.source === source));
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
