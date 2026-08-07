import { AgentException } from "./AgentException.ts";

export class AgentCapability {
  readonly identifier: string;
  readonly name: string;

  constructor(identifier: string, name: string = identifier) {
    if (identifier.trim() === "" || name.trim() === "") throw new AgentException("Capability identifier and name are required");
    this.identifier = identifier;
    this.name = name;
  }
}
