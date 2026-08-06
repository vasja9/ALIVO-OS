export interface RepositoryTransaction {
  begin(): void;
  commit(): void;
  rollback(): void;
  isActive(): boolean;
}
