import { SecretException } from "./SecretException.ts";
import { SecretId } from "./SecretId.ts";
import { SystemIdentity } from "./SystemIdentity.ts";

export interface SecretAccessRequestProperties { readonly requestingIdentity: SystemIdentity; readonly secretId: SecretId; readonly purpose: string;
  readonly taskOrWorkflowId?: string; readonly timestamp?: Date; }
export class SecretAccessRequest {
  readonly requestingIdentity: SystemIdentity; readonly secretId: SecretId; readonly purpose: string; readonly taskOrWorkflowId?: string; readonly #timestamp: number;
  constructor(properties: SecretAccessRequestProperties) {
    if (!(properties?.requestingIdentity instanceof SystemIdentity) || !(properties.secretId instanceof SecretId) || typeof properties.purpose !== "string" || properties.purpose.trim().length === 0 ||
      (properties.taskOrWorkflowId !== undefined && (typeof properties.taskOrWorkflowId !== "string" || properties.taskOrWorkflowId.trim().length === 0))) throw new SecretException("Invalid secret access request");
    this.#timestamp = properties.timestamp?.getTime() ?? Date.now(); if (Number.isNaN(this.#timestamp)) throw new SecretException("Invalid secret access request timestamp");
    this.requestingIdentity = properties.requestingIdentity; this.secretId = properties.secretId; this.purpose = properties.purpose; this.taskOrWorkflowId = properties.taskOrWorkflowId;
    Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestamp); }
}
