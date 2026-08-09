export const desktopDestinations = [
  "Dashboard", "Questions", "Blogs", "Pinterest", "Library", "Performance", "System", "Settings",
] as const;

export type DesktopDestination = (typeof desktopDestinations)[number];
export type OverallState = "Operational" | "Working" | "AttentionRequired" | "Degraded" | "Paused" | "Offline";
export type DataState = "Loading" | "Ready" | "Empty" | "Error";
export type CommandState = "Idle" | "Submitting" | "Succeeded" | "Failed" | "Conflict" | "AuthorizationDenied" | "ValidationFailed" | "CommandAccepted" | "BusinessOperationCompleted";

export interface BusinessPackageScope { readonly businessPackageId: string }

export interface DesktopSystemStatus extends BusinessPackageScope {
  readonly overallState: OverallState;
  readonly activeWorkflows: number;
  readonly attentionCount: number;
  readonly integrationWarnings: readonly string[];
  readonly authenticationWarnings: readonly string[];
  readonly lastCriticalFailure?: string;
  readonly nextScheduledAction?: string;
  readonly currentTimeContext?: string;
  readonly lastUpdated: string;
  readonly stale: boolean;
}

export interface DesktopStatusQuery {
  execute(scope: BusinessPackageScope): Promise<DesktopSystemStatus>;
}

export interface DesktopCommand<TResult = unknown> extends BusinessPackageScope {
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DesktopCommandResult<TResult = unknown> extends BusinessPackageScope {
  readonly state: Exclude<CommandState, "Idle" | "Submitting">;
  readonly value?: TResult;
  readonly message?: string;
  readonly correlationId?: string;
  readonly workflowId?: string;
}

export interface DesktopCommandGateway {
  execute<TResult>(command: DesktopCommand<TResult>): Promise<DesktopCommandResult<TResult>>;
}
