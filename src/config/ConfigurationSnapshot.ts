import { ConfigurationException } from "./ConfigurationException.ts";
import { ConfigurationKey } from "./ConfigurationKey.ts";
import { ConfigurationValue } from "./ConfigurationValue.ts";

/** Immutable point-in-time view of registered configuration. */
export class ConfigurationSnapshot {
  readonly #values: ReadonlyMap<string, ConfigurationValue>;

  constructor(values: ReadonlyMap<string, ConfigurationValue>) {
    this.#values = new Map(values);
    Object.freeze(this);
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

  listNonSensitiveKeys(): readonly ConfigurationKey[] {
    return Object.freeze(
      Array.from(this.#values.entries())
        .filter(([, value]) => !value.sensitive)
        .map(([identifier]) => new ConfigurationKey(identifier))
        .sort((left, right) => left.identifier.localeCompare(right.identifier)),
    );
  }
}
