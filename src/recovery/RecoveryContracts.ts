export enum BackupState { Creating="Creating", Verifying="Verifying", Verified="Verified", Failed="Failed", Corrupt="Corrupt", Unsupported="Unsupported", MigrationRequired="Migration Required" }
export enum RecoverySourceState { Verified="Verified", Healthy="Healthy", PartiallyRecoverable="Partially Recoverable", Corrupt="Corrupt", Unsupported="Unsupported", MigrationRequired="Migration Required", Unknown="Unknown" }
export enum RecoveryPhase { Scanning="Scanning", Verifying="Verifying", ForensicCopy="Creating Forensic Copy", SelectingBase="Selecting Base", Migrating="Migrating", Salvaging="Salvaging", Validating="Validating", Activating="Activating", Completed="Completed" }

export interface PersistentArtifact {
  readonly stableId: string;
  readonly version: number;
  readonly businessPackageId: string;
  readonly type: string;
  readonly updatedAt: string;
  readonly payload: unknown;
  readonly dependencies?: readonly string[];
  readonly provenance?: string;
}

export interface BackupManifest {
  readonly backupId: string;
  readonly createdAt: string;
  readonly applicationVersion: string;
  readonly backupSchemaVersion: number;
  readonly databaseSchemaVersion: number;
  readonly backupFormatVersion: number;
  readonly businessPackageScope: readonly string[];
  readonly contentInventory: Readonly<Record<string, number>>;
  readonly artifacts: readonly { path:string; stableId:string; version:number; businessPackageId:string; type:string; checksum:string }[];
  readonly completionState: "Complete";
  readonly verificationState: "Pending" | "Verified";
}

export interface RecoverySource { readonly type:"Backup"|"Snapshot"|"Persistent State"; readonly location:string; readonly date?:string; readonly applicationVersion?:string; readonly schemaVersion?:number; readonly state:RecoverySourceState; readonly newestRecordAt?:string; readonly recoverable:boolean }
export interface RecoveryConflict { readonly stableId:string; readonly base:PersistentArtifact; readonly candidate:PersistentArtifact; readonly reason:string; }
export interface RecoveryPlan { readonly selectedBase:string; readonly recoverable:readonly PersistentArtifact[]; readonly rejected:readonly { artifact?:PersistentArtifact; reason:string }[]; readonly conflicts:readonly RecoveryConflict[]; readonly migrationRequired:boolean; readonly safe:boolean }
export interface RecoveryHistoryEntry { readonly problem:string; readonly artifactId?:string; readonly source?:string; readonly sourceVersion?:number; readonly recoveredVersion?:number; readonly validation:"PASS"|"FAIL"; readonly timestamp:string; }
export interface RecoveryReport { readonly sources:readonly RecoverySource[]; readonly selectedBase?:string; readonly recordsInspected:number; readonly recordsRecovered:number; readonly rejected:RecoveryPlan["rejected"]; readonly conflicts:RecoveryPlan["conflicts"]; readonly migrations:readonly string[]; readonly validation:"PASS"|"FAIL"; readonly activation:"Activated"|"Not Activated"; readonly timestamp:string; }
export interface RecoveryPolicy { readonly monthlyBackupEnabled:boolean; readonly retentionGenerations:number; readonly snapshotRetention:number; readonly backupLocation:string; }
export const DEFAULT_RECOVERY_POLICY:RecoveryPolicy=Object.freeze({monthlyBackupEnabled:true,retentionGenerations:12,snapshotRetention:10,backupLocation:"backups"});
