import { ConfigurationException } from "./ConfigurationException.ts";

/** Immutable identifier for a configuration entry. */
export class ConfigurationKey {
  readonly #identifier: string;

  constructor(identifier: string) {
    if (identifier.trim().length === 0) {
      throw new ConfigurationException("Configuration key must not be empty");
    }

    this.#identifier = identifier;
    Object.freeze(this);
  }

  get identifier(): string {
    return this.#identifier;
  }

  equals(other: ConfigurationKey): boolean {
    return this.#identifier === other.#identifier;
  }

  toString(): string {
    return this.#identifier;
  }
}
