import { AuditEvent } from "./AuditEvent.ts";
import { AuditEventType } from "./AuditEventType.ts";
import { AuditRecorder } from "./AuditRecorder.ts";
import { EventException } from "./EventException.ts";
import { EventRegistry } from "./EventRegistry.ts";
import { EventSubscription } from "./EventSubscription.ts";
import { LogEntry } from "./LogEntry.ts";
import { LogLevel } from "./LogLevel.ts";
import { Logger } from "./Logger.ts";
import { SystemEvent } from "./SystemEvent.ts";

/** Synchronous reporting delivery only; this class performs no operational action. */
export class EventDispatcher {
  constructor(
    private readonly registry?: EventRegistry,
    private readonly logger?: Logger,
    private readonly auditRecorder?: AuditRecorder,
  ) {}

  dispatch(event: SystemEvent, subscriptions = this.registry?.list() ?? []): readonly EventException[] {
    if (!(event instanceof SystemEvent)) throw new EventException("Cannot dispatch an invalid system event");
    const failures: EventException[] = [];
    for (const subscription of [...subscriptions].sort((a, b) => a.registrationOrder - b.registrationOrder)) {
      if (!subscription.accepts(event)) continue;
      try { subscription.listener.handle(event); }
      catch (cause) {
        const failure = new EventException(`Event listener failed while handling event: ${event.id.value}`, { cause });
        failures.push(failure);
        this.#reportFailure(event, subscription, failure);
      }
    }
    return Object.freeze(failures);
  }

  #reportFailure(event: SystemEvent, subscription: EventSubscription, failure: EventException): void {
    const context = { eventId: event.id.value, subscriptionId: subscription.id, error: failure.message };
    this.logger?.record(new LogEntry({ level: LogLevel.Error, source: "EventDispatcher", message: "Event listener delivery failed", context, relatedOperationId: event.correlationId }));
    this.auditRecorder?.append(new AuditEvent({ type: AuditEventType.ApplicationLifecycle, source: "EventDispatcher", action: "deliver-event", result: "listener-failed", responsibleIdentity: event.source, relatedTaskOrWorkflowId: event.taskId ?? event.workflowId, context }));
  }
}
