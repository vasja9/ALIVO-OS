import { ConfigurationSource } from "./ConfigurationSource.ts";

const REDACTED_VALUE = "[REDACTED]";

/** A configuration value and the metadata describing its origin. */
export class ConfigurationValue<T = unknown> {
  readonly #value: T;

  constructor(
    value: T,
    readonly source: ConfigurationSource,
    readonly description?: string,
    readonly sensitive = false,
  ) {
    this.#value = value;
    Object.freeze(this);
  }

  get value(): T {
    return this.#value;
  }

  toString(): string {
    return this.sensitive ? REDACTED_VALUE : String(this.#value);
  }

  toJSON(): Readonly<{
    value: T | string;
    source: ConfigurationSource;
    description?: string;
    sensitive: boolean;
  }> {
    return {
      value: this.sensitive ? REDACTED_VALUE : this.#value,
      source: this.source,
      description: this.description,
      sensitive: this.sensitive,
    };
  }
}
