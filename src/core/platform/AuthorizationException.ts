/** Base failure raised by the identity and authorization foundation. */
export class AuthorizationException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthorizationException";
  }
}
