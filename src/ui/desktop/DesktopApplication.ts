import type { BusinessPackageScope, CommandState, DesktopCommand, DesktopCommandGateway, DesktopCommandResult, DesktopStatusQuery, DesktopSystemStatus } from "./DesktopContracts.ts";

const REDACTED = "[REDACTED]";
const secretKey = /(password|authorization|token|api.?key|secret|credential|vault)/i;

/** Sanitizes backend-provided detail before it reaches desktop rendering or logs. */
export function sanitizeForDesktop(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/\b(password|application_password|access_token|refresh_token|api_key|master_password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(sanitizeForDesktop);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? REDACTED : sanitizeForDesktop(item)]));
  }
  return value;
}

export class DesktopApplication {
  private scope: BusinessPackageScope;
  commandState: CommandState = "Idle";

  constructor(private readonly statusQuery: DesktopStatusQuery, private readonly commandGateway: DesktopCommandGateway, businessPackageId = "ALIVO") {
    this.scope = Object.freeze({ businessPackageId });
  }

  get activeBusinessPackage(): string { return this.scope.businessPackageId; }

  async loadStatus(): Promise<DesktopSystemStatus> {
    const result = await this.statusQuery.execute(this.scope);
    if (result.businessPackageId !== this.scope.businessPackageId) throw new Error("The response belongs to a different Business Package.");
    return sanitizeForDesktop(result) as DesktopSystemStatus;
  }

  async send<TResult>(name: string, payload: Readonly<Record<string, unknown>> = {}): Promise<DesktopCommandResult<TResult>> {
    this.commandState = "Submitting";
    const command: DesktopCommand<TResult> = { ...this.scope, name, payload };
    const result = await this.commandGateway.execute(command);
    if (result.businessPackageId !== this.scope.businessPackageId) {
      this.commandState = "Failed";
      throw new Error("The command result belongs to a different Business Package.");
    }
    this.commandState = result.state;
    return sanitizeForDesktop(result) as DesktopCommandResult<TResult>;
  }
}
