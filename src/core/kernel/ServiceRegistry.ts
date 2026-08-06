export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<T>(serviceId: string, service: T): void {
    if (this.services.has(serviceId)) {
      throw new Error(`Service is already registered: ${serviceId}`);
    }

    this.services.set(serviceId, service);
  }

  get<T>(serviceId: string): T | undefined {
    return this.services.get(serviceId) as T | undefined;
  }

  require<T>(serviceId: string): T {
    const service = this.get<T>(serviceId);
    if (service === undefined) {
      throw new Error(`Service is not registered: ${serviceId}`);
    }

    return service;
  }
}
