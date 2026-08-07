/** Foundation-only operational event classifications. */
export enum EventCategory {
  SystemLifecycle = "SystemLifecycle",
  ModuleLifecycle = "ModuleLifecycle",
  TaskExecution = "TaskExecution",
  WorkflowExecution = "WorkflowExecution",
  AgentAvailability = "AgentAvailability",
  AgentHealth = "AgentHealth",
  AgentAssignment = "AgentAssignment",
  ApprovalRequired = "ApprovalRequired",
  Recovery = "Recovery",
  Failure = "Failure",
  Security = "Security",
  IntegrationHealth = "IntegrationHealth",
  Configuration = "Configuration",
  Audit = "Audit",
}
