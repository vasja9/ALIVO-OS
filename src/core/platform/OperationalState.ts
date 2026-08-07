/** Lifecycle states used by the operational coordinator and its tasks. */
export enum OperationalState {
  Idle = "Idle",
  Preparing = "Preparing",
  Executing = "Executing",
  Waiting = "Waiting",
  Paused = "Paused",
  Recovering = "Recovering",
  Completed = "Completed",
  Failed = "Failed",
}
