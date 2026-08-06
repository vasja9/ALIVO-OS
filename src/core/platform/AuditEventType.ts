/** Non-business-specific classifications for authoritative audit records. */
export enum AuditEventType {
  ApplicationLifecycle = "ApplicationLifecycle",
  ModuleLifecycle = "ModuleLifecycle",
  ConfigurationChange = "ConfigurationChange",
  ApprovalDecision = "ApprovalDecision",
  SecurityEvent = "SecurityEvent",
  WorkflowEvent = "WorkflowEvent",
  DataLifecycle = "DataLifecycle",
  ExternalIntegration = "ExternalIntegration",
}
