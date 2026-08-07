import { OperationalException } from "./OperationalException.ts";
import { OperationalTask } from "./OperationalTask.ts";

/** Priority queue for pending operational work, including delayed retries. */
export class OperationalQueue {
  readonly #tasks: OperationalTask[] = [];

  enqueue(task: OperationalTask): void {
    if (this.#tasks.some((queued) => queued.taskIdentifier === task.taskIdentifier)) {
      throw new OperationalException(`Task is already queued: ${task.taskIdentifier}`);
    }
    this.#tasks.push(task);
    this.sort();
  }

  dequeue(at: Date = new Date()): OperationalTask | undefined {
    const index = this.#tasks.findIndex((task) => task.retryAt === undefined || task.retryAt <= at);
    return index < 0 ? undefined : this.#tasks.splice(index, 1)[0];
  }

  peek(at: Date = new Date()): OperationalTask | undefined {
    return this.#tasks.find((task) => task.retryAt === undefined || task.retryAt <= at);
  }

  scheduleRetry(task: OperationalTask, retryAt: Date): void {
    if (!Number.isFinite(retryAt.getTime())) throw new OperationalException("Retry time must be valid");
    task.retryAt = retryAt;
    if (!this.#tasks.includes(task)) this.enqueue(task);
    else this.sort();
  }

  inspect(): readonly OperationalTask[] {
    return Object.freeze([...this.#tasks]);
  }

  private sort(): void {
    this.#tasks.sort((left, right) =>
      right.priority - left.priority || left.creationTime.getTime() - right.creationTime.getTime() ||
      left.taskIdentifier.localeCompare(right.taskIdentifier));
  }
}
