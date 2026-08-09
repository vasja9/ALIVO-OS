import { BusinessPackageId } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketSourceCapability } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import { PinterestCapabilityState, PinterestConnectionState, PinterestConnectionVerificationException, PinterestConnectionVerificationId, PinterestConnectionVerificationResult } from "./PinterestConnectionVerificationDomain.ts";

export class PinterestConnectionVerificationRepository {
  readonly #results=new Map<string,PinterestConnectionVerificationResult>();
  store(result:PinterestConnectionVerificationResult){if(this.#results.has(result.id.value))throw new PinterestConnectionVerificationException("Verification result is immutable","DUPLICATE_VERIFICATION");this.#results.set(result.id.value,result);}
  get(id:PinterestConnectionVerificationId|{readonly id:PinterestConnectionVerificationId}){const reference=id instanceof PinterestConnectionVerificationId?id:id.id;return this.#results.get(reference.value);}
  history(businessPackageId?:BusinessPackageId){return this.ordered([...this.#results.values()].filter(x=>!businessPackageId||x.properties.businessPackageId.value===businessPackageId.value));}
  current(businessPackageId:BusinessPackageId,adapterReference?:string){return this.history(businessPackageId).filter(x=>!adapterReference||x.properties.adapterId.value===adapterReference).at(-1);}
  lastSuccessful(businessPackageId:BusinessPackageId){return this.history(businessPackageId).filter(x=>x.state===PinterestConnectionState.Available||x.state===PinterestConnectionState.PartiallyAvailable).at(-1);}
  lastFailed(businessPackageId:BusinessPackageId){return this.history(businessPackageId).filter(x=>![PinterestConnectionState.Available,PinterestConnectionState.PartiallyAvailable].includes(x.state)).at(-1);}
  byConnectionState(state:PinterestConnectionState){return this.ordered([...this.#results.values()].filter(x=>x.state===state));}
  byCapability(capability:MarketSourceCapability,state?:PinterestCapabilityState){return this.ordered([...this.#results.values()].filter(x=>x.capabilities.some(c=>c.capability.equals(capability)&&(!state||c.state===state))));}
  private ordered(values:PinterestConnectionVerificationResult[]){return Object.freeze(values.sort((a,b)=>a.verifiedAt.getTime()-b.verifiedAt.getTime()||a.id.value.localeCompare(b.id.value)));}
}
