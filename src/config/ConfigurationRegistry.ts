import { ConfigurationException } from "./ConfigurationException.ts";
import { ConfigurationKey } from "./ConfigurationKey.ts";
import { ConfigurationSnapshot } from "./ConfigurationSnapshot.ts";
import { ConfigurationValue } from "./ConfigurationValue.ts";

/** Mutable registration boundary for application configuration. */
export class ConfigurationRegistry {
  readonly #values = new Map<string, ConfigurationValue>();

  register<T>(key: ConfigurationKey, value: ConfigurationValue<T>): void {
    if (this.#values.has(key.identifier)) {
      throw new ConfigurationException(
        `Configuration value is already registered: ${key.identifier}`,
      );
    }

    this.#values.set(key.identifier, value);
  }

  get<T = unknown>(key: ConfigurationKey): ConfigurationValue<T> | undefined {
    return this.#values.get(key.identifier) as ConfigurationValue<T> | undefined;
  }

  require<T = unknown>(key: ConfigurationKey): ConfigurationValue<T> {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new ConfigurationException(
        `Required configuration value is not registered: ${key.identifier}`,
      );
    }

    return value;
  }

  replace<T>(key: ConfigurationKey, value: ConfigurationValue<T>): void {
    if (!this.#values.has(key.identifier)) {
      throw new ConfigurationException(
        `Configuration value cannot be replaced because it is not registered: ${key.identifier}`,
      );
    }

    this.#values.set(key.identifier, value);
  }

  snapshot(): ConfigurationSnapshot {
    return new ConfigurationSnapshot(this.#values);
  }

  listNonSensitiveKeys(): readonly ConfigurationKey[] {
    return this.snapshot().listNonSensitiveKeys();
  }
}
