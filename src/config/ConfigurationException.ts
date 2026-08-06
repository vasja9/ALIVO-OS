/** Base exception for failures in the configuration foundation. */
export class ConfigurationException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationException";
  }
}
