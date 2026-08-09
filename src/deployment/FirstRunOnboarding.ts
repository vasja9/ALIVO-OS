import { dirname, parse, resolve } from "node:path";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const ONBOARDING_VERSION = 1;
export const ALIVO_PACKAGE = "PACKAGE-ALIVO";

export type OnboardingPath = "New" | "Recovery";
export type ConnectionState = "Not Configured" | "Authentication Required" | "Connected" | "Invalid Credential" | "Permission Denied" | "Site Unreachable" | "Configuration Invalid" | "Reauthorization Required" | "Rate Limited" | "Unavailable";
export type ReadinessCategory = "Ready" | "Ready with Warnings" | "Attention Required" | "Blocked";
export type OnboardingStep = "Welcome" | "Path" | "Security" | "Business Package" | "WordPress" | "Pinterest" | "Research Sources" | "Analytics / Discovery" | "Library" | "Backup Location" | "Validation" | "Ready";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze(["Welcome", "Path", "Security", "Business Package", "WordPress", "Pinterest", "Research Sources", "Analytics / Discovery", "Library", "Backup Location", "Validation", "Ready"]);

export interface GovernedDefaults { language: string; market: string; blogPublishingAuthority: string; libraryWriteAuthority: string; pinterestMinimumIntervalMinutes: number; minimumPinsPerBlog: number; blogPinterestPromotionEnabled: boolean }
export interface IntegrationSummary { state: ConnectionState; safeIdentity?: string; checkedAt?: string }
export interface SourceConfiguration { id: string; name: string; requirement: "Required" | "Recommended" | "Optional"; enabled: boolean; authenticationRequired: boolean; state: ConnectionState; markets: readonly string[]; languages: readonly string[] }
export interface OnboardingState {
  schemaVersion: 1; completed: boolean; currentStep: OnboardingStep; completedSteps: readonly OnboardingStep[]; path?: OnboardingPath;
  businessPackage?: { id: typeof ALIVO_PACKAGE; name: "ALIVO" }; defaults?: GovernedDefaults; vaultInitialized: boolean;
  wordpress: IntegrationSummary; pinterest: IntegrationSummary; sources: readonly SourceConfiguration[]; analyticsConfigured: boolean;
  library: { state: "Not Initialized" | "Initialized" | "Import Pending"; knowledge: "Attached" | "Add Later"; starterImported: boolean };
  backup: { location?: string; verified: boolean; sameDiskWarning: boolean }; recovered: boolean; recoveryCredentialsAvailable?: boolean;
}
export interface StateStorage { load(): Promise<OnboardingState | undefined>; save(state: OnboardingState): Promise<void> }
export interface VaultInitializer { initialize(masterPassword: string, confirmation: string): Promise<void> }
export interface ConnectionVerifier { verify(input: Readonly<Record<string, string>>): Promise<{ state: ConnectionState; safeIdentity?: string }> }
export interface RecoveryHandoff { discover(manualSource?: string): Promise<readonly { location: string; kind: "Existing Data" | "Local Snapshot" | "Backup Archive" | "Manual Source" }[]>; open(source?: string): Promise<{ restored: boolean; credentialsAvailable: boolean; defaults?: GovernedDefaults }> }

const blank = (): OnboardingState => ({ schemaVersion: 1, completed: false, currentStep: "Welcome", completedSteps: [], vaultInitialized: false, wordpress: { state: "Not Configured" }, pinterest: { state: "Not Configured" }, sources: [], analyticsConfigured: false, library: { state: "Not Initialized", knowledge: "Add Later", starterImported: false }, backup: { verified: false, sameDiskWarning: false }, recovered: false });
const clone = (state: OnboardingState): OnboardingState => structuredClone(state);

/** Atomic JSON storage for non-secret onboarding state. The vault remains a separate boundary. */
export class FileOnboardingStateStorage implements StateStorage {
  constructor(readonly location: string) {}
  async load(): Promise<OnboardingState | undefined> { try { return JSON.parse(await readFile(this.location, "utf8")) as OnboardingState; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  async save(state: OnboardingState): Promise<void> { await mkdir(dirname(this.location), { recursive: true }); const temporary = `${this.location}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.location); }
}

export class FirstRunOnboarding {
  #state: OnboardingState = blank();
  constructor(private readonly storage: StateStorage, private readonly vault: VaultInitializer, private readonly wordpressVerifier: ConnectionVerifier, private readonly pinterestVerifier: ConnectionVerifier, private readonly recovery: RecoveryHandoff, private readonly applicationDirectory: string, private readonly persistentDataDirectory: string) {}
  async start(): Promise<{ showOnboarding: boolean; state: OnboardingState }> { const stored = await this.storage.load(); if (stored?.schemaVersion === ONBOARDING_VERSION) this.#state = stored; return { showOnboarding: !this.#state.completed, state: clone(this.#state) }; }
  state(): OnboardingState { return clone(this.#state); }
  async detectHistoricalData(): Promise<readonly { location: string; kind: "Existing Data" | "Local Snapshot" | "Backup Archive" | "Manual Source" }[]> { return this.recovery.discover(); }
  async startNew(defaults: GovernedDefaults): Promise<void> { if ((await this.recovery.discover()).length) throw new Error("Existing ALIVO OS data found. Recovery must be considered before starting new."); this.#state = { ...blank(), path: "New", businessPackage: { id: ALIVO_PACKAGE, name: "ALIVO" }, defaults: { ...defaults }, currentStep: "Security", completedSteps: ["Welcome", "Path", "Business Package"] }; await this.persist(); }
  async recover(source?: string): Promise<void> { const result = await this.recovery.open(source); if (!result.restored) throw new Error("Recovery did not activate restored state."); this.#state = { ...blank(), path: "Recovery", recovered: true, recoveryCredentialsAvailable: result.credentialsAvailable, defaults: result.defaults, businessPackage: { id: ALIVO_PACKAGE, name: "ALIVO" }, currentStep: "Security", completedSteps: ["Welcome", "Path", "Business Package"] }; if (!result.credentialsAvailable) this.#state.wordpress = this.#state.pinterest = { state: "Authentication Required" }; await this.persist(); }
  async initializeVault(masterPassword: string, confirmation: string): Promise<void> { if (masterPassword.length < 12) throw new Error("Master Password must contain at least 12 characters."); if (masterPassword !== confirmation) throw new Error("Master Password confirmation does not match."); await this.vault.initialize(masterPassword, confirmation); this.#state.vaultInitialized = true; await this.completeStep("Security", "WordPress"); }
  async configureWordPress(input: Readonly<Record<string, string>>): Promise<IntegrationSummary> { return this.verify("wordpress", input); }
  async configurePinterest(input: Readonly<Record<string, string>>): Promise<IntegrationSummary> { return this.verify("pinterest", input); }
  async configureSources(sources: readonly SourceConfiguration[]): Promise<void> { this.#state.sources = sources.map(source => ({ ...source, markets: [...source.markets], languages: [...source.languages] })); await this.completeStep("Research Sources", "Analytics / Discovery"); }
  async configureAnalytics(configured: boolean): Promise<void> { this.#state.analyticsConfigured = configured; await this.completeStep("Analytics / Discovery", "Library"); }
  async configureLibrary(input: OnboardingState["library"]): Promise<void> { this.#state.library = { ...input }; await this.completeStep("Library", "Backup Location"); }
  async configureBackup(location: string): Promise<void> { const target = resolve(location), data = resolve(this.persistentDataDirectory); await mkdir(target, { recursive: true }); const probe = `${target}/.alivo-write-test-${randomUUID()}`; const value = randomUUID(); try { await writeFile(probe, value, { mode: 0o600 }); if (await readFile(probe, "utf8") !== value) throw new Error("Backup verification read did not match write."); } finally { await rm(probe, { force: true }); } await mkdir(`${data}/recovery/snapshots`, { recursive: true }); const sameDiskWarning = parse(target).root === parse(data).root; this.#state.backup = { location: target, verified: true, sameDiskWarning }; await this.completeStep("Backup Location", "Validation"); }
  async verifyPermissions(): Promise<boolean> { try { await mkdir(this.persistentDataDirectory, { recursive: true }); const info = await stat(this.persistentDataDirectory); return info.isDirectory() && resolve(this.persistentDataDirectory) !== resolve(this.applicationDirectory) && !resolve(this.persistentDataDirectory).startsWith(`${resolve(this.applicationDirectory)}/`); } catch { return false; } }
  async readiness(): Promise<{ category: ReadinessCategory; blockers: readonly string[]; warnings: readonly string[] }> { const blockers: string[] = [], warnings: string[] = []; if (!(await this.verifyPermissions())) blockers.push("Persistent storage is unavailable or inside the application directory."); if (!this.#state.vaultInitialized) blockers.push("Credential Vault is not initialized."); if (this.#state.businessPackage?.id !== ALIVO_PACKAGE) blockers.push("ALIVO Business Package is invalid."); if (!this.#state.backup.verified) blockers.push("Backup destination has not been verified."); for (const source of this.#state.sources) if (source.enabled && source.state !== "Connected") (source.requirement === "Required" ? blockers : warnings).push(`${source.name}: ${source.state}`); for (const [name, integration] of [["WordPress", this.#state.wordpress], ["Pinterest", this.#state.pinterest]] as const) if (integration.state !== "Connected") warnings.push(`${name}: ${integration.state}`); if (this.#state.library.state === "Not Initialized") warnings.push("Library will be initialized later."); const category: ReadinessCategory = blockers.length ? "Blocked" : warnings.length ? "Ready with Warnings" : "Ready"; return { category, blockers, warnings }; }
  async finish(): Promise<void> { const result = await this.readiness(); if (result.category === "Blocked") throw new Error("Core readiness checks are blocked."); this.#state.completed = true; this.#state.currentStep = "Ready"; this.#state.completedSteps = [...new Set([...this.#state.completedSteps, "Validation", "Ready"])] as OnboardingStep[]; await this.persist(); }
  async cancelAt(step: OnboardingStep): Promise<void> { this.#state.currentStep = step; await this.persist(); }
  private async verify(kind: "wordpress" | "pinterest", input: Readonly<Record<string, string>>): Promise<IntegrationSummary> { const result = await (kind === "wordpress" ? this.wordpressVerifier : this.pinterestVerifier).verify(input); const summary = { ...result, checkedAt: new Date().toISOString() }; this.#state[kind] = summary; await this.persist(); return { ...summary }; }
  private async completeStep(step: OnboardingStep, next: OnboardingStep): Promise<void> { this.#state.completedSteps = [...new Set([...this.#state.completedSteps, step])]; this.#state.currentStep = next; await this.persist(); }
  private async persist(): Promise<void> { await this.storage.save(clone(this.#state)); }
}
