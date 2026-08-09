import type { CompetitiveAnalysis, CompetitiveObservation } from "../../business/market/competitive/CompetitiveIntelligenceDomain.ts";
import { BusinessPackageId, MarketObservation, Provenance } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import type { MarketDataValidationResult } from "../../intelligence/market/quality/MarketDataQualityDomain.ts";
import type { PinterestOwnership } from "./PinterestMarketSourceAdapter.ts";

export class PinterestCompetitiveIntakeException extends Error {
  constructor(message:string,readonly code="PINTEREST_COMPETITIVE_INTAKE_FAILURE",options?:ErrorOptions){super(message,options);this.name="PinterestCompetitiveIntakeException";}
}
const required=(v:string,n:string)=>{if(typeof v!=="string"||!v.trim())throw new PinterestCompetitiveIntakeException(`${n} is required`);return v;};
const instant=(v:Date,n:string)=>{if(!(v instanceof Date)||!Number.isFinite(v.getTime()))throw new PinterestCompetitiveIntakeException(`${n} is invalid`);return v.getTime();};
export class PinterestCompetitiveIntakeId { constructor(readonly value:string){required(value,"Intake identifier");Object.freeze(this);} }
export interface PinterestCompetitiveInput { observation:MarketObservation;validation:MarketDataValidationResult; }
export interface PinterestCompetitiveIntakeRequestProperties { id:PinterestCompetitiveIntakeId;observations:readonly PinterestCompetitiveInput[];businessPackageId:BusinessPackageId;collectionWorkflowReference:string;correlationIdentifier:string;requestingAuthorityReference:string;requestedAt:Date;includeOwned?:boolean; }
export class PinterestCompetitiveIntakeRequest {
  readonly observations:readonly PinterestCompetitiveInput[];readonly #at:number;
  constructor(readonly properties:PinterestCompetitiveIntakeRequestProperties){required(properties.collectionWorkflowReference,"Collection workflow reference");required(properties.correlationIdentifier,"Correlation identifier");required(properties.requestingAuthorityReference,"Requesting authority reference");this.#at=instant(properties.requestedAt,"Request timestamp");this.observations=Object.freeze([...properties.observations]);Object.freeze(properties);Object.freeze(this);}
  get id(){return this.properties.id;}get requestedAt(){return new Date(this.#at);}
}
export enum PinterestCompetitiveSkipReason { NotDataQualityAccepted="NotDataQualityAccepted",HistoricalOnly="HistoricalOnly",OwnedResourceNotRequested="OwnedResourceNotRequested",UnknownOwnership="UnknownOwnership",DuplicateUnderlyingArtefact="DuplicateUnderlyingArtefact",InsufficientCompetitiveData="InsufficientCompetitiveData",UnsupportedObservationType="UnsupportedObservationType",Other="Other" }
export enum PinterestCompetitiveIntakeStatus { Completed="Completed",CompletedWithWarnings="CompletedWithWarnings",Partial="Partial",Failed="Failed" }
export interface PinterestCompetitiveDisposition { observationId:string;ownership?:PinterestOwnership;competitiveObservationId?:string;analysisId?:string;skipReason?:PinterestCompetitiveSkipReason;warning?:string; }
export interface PinterestCompetitiveIntakeResultProperties { intakeId:PinterestCompetitiveIntakeId;businessPackageId:BusinessPackageId;inputObservationCount:number;eligibleCount:number;skippedCount:number;duplicateRelatedSkipCount:number;competitiveObservations:readonly CompetitiveObservation[];competitiveAnalyses:readonly CompetitiveAnalysis[];dispositions:readonly PinterestCompetitiveDisposition[];warnings:readonly string[];failures:readonly string[];startedAt:Date;completedAt:Date;correlationIdentifier:string;provenance:Provenance;status:PinterestCompetitiveIntakeStatus; }
export class PinterestCompetitiveIntakeResult {
  readonly competitiveObservations:readonly CompetitiveObservation[];readonly competitiveAnalyses:readonly CompetitiveAnalysis[];readonly dispositions:readonly PinterestCompetitiveDisposition[];readonly warnings:readonly string[];readonly failures:readonly string[];readonly #started:number;readonly #completed:number;
  constructor(readonly properties:PinterestCompetitiveIntakeResultProperties){this.#started=instant(properties.startedAt,"Start timestamp");this.#completed=instant(properties.completedAt,"Completion timestamp");required(properties.correlationIdentifier,"Correlation identifier");this.competitiveObservations=Object.freeze([...properties.competitiveObservations]);this.competitiveAnalyses=Object.freeze([...properties.competitiveAnalyses]);this.dispositions=Object.freeze(properties.dispositions.map(x=>Object.freeze({...x})));this.warnings=Object.freeze([...properties.warnings]);this.failures=Object.freeze([...properties.failures]);Object.freeze(properties);Object.freeze(this);}
  get startedAt(){return new Date(this.#started);}get completedAt(){return new Date(this.#completed);}get status(){return this.properties.status;}
}
