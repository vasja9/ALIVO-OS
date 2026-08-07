export class AgentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentException";
  }
}
