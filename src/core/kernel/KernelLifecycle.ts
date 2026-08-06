import { KernelState } from "./KernelState";

const allowedTransitions: Readonly<Record<KernelState, readonly KernelState[]>> = {
  [KernelState.Created]: [KernelState.Initializing],
  [KernelState.Initializing]: [KernelState.Running, KernelState.Failed],
  [KernelState.Running]: [KernelState.Stopping, KernelState.Failed],
  [KernelState.Stopping]: [KernelState.Stopped, KernelState.Failed],
  [KernelState.Stopped]: [],
  [KernelState.Failed]: [KernelState.Stopping],
};

export class KernelLifecycle {
  private currentState = KernelState.Created;

  get state(): KernelState {
    return this.currentState;
  }

  transitionTo(nextState: KernelState): void {
    if (!allowedTransitions[this.currentState].includes(nextState)) {
      throw new Error(
        `Invalid kernel lifecycle transition: ${this.currentState} -> ${nextState}`,
      );
    }

    this.currentState = nextState;
  }

  fail(): void {
    if (this.currentState !== KernelState.Failed) {
      this.transitionTo(KernelState.Failed);
    }
  }
}
