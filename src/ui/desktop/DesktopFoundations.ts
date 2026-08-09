import type { CommandState, DataState } from "./DesktopContracts.ts";

export interface WorkspaceState<T> {
  readonly state: DataState;
  readonly data?: T;
  readonly lastUpdated?: string;
  readonly refreshing: boolean;
  readonly stale: boolean;
  readonly error?: { readonly summary: string; readonly actionRequired: boolean; readonly retryable: boolean; readonly technicalDetail?: string };
}

export interface DataColumn<T> {
  readonly key: keyof T;
  readonly label: string;
  readonly sortable?: boolean;
  readonly searchable?: boolean;
}

export interface DataPage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
}

export interface DetailPanelModel {
  readonly title: string;
  readonly description?: string;
  readonly sections: readonly { readonly label: string; readonly value: string }[];
}

export interface ConfirmationModel {
  readonly title: string;
  readonly message: string;
  readonly confirmationLabel: string;
  readonly destructive: boolean;
}

export interface CommandFeedback {
  readonly state: CommandState;
  readonly message?: string;
  readonly correlationId?: string;
  readonly workflowId?: string;
}

export type ValidationPresentation = "PASS" | "WARN" | "FAIL";
