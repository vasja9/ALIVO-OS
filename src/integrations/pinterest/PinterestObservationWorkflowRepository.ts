import { PinterestObservationWorkflowException, PinterestObservationWorkflowId, PinterestObservationWorkflowResult, PinterestObservationWorkflowState } from "./PinterestObservationWorkflowDomain.ts";

export interface PinterestObservationWorkflowHistoryEntry { readonly state:PinterestObservationWorkflowState;readonly at:Date;readonly detail?:string; }
export class PinterestObservationWorkflowRepository {
  readonly #history=new Map<string,PinterestObservationWorkflowHistoryEntry[]>();readonly #results=new Map<string,PinterestObservationWorkflowResult>();
  transition(id:PinterestObservationWorkflowId,state:PinterestObservationWorkflowState,at:Date,detail?:string){const history=this.#history.get(id.value)??[];history.push(Object.freeze({state,at:new Date(at),...(detail&&{detail})}));this.#history.set(id.value,history);}
  store(result:PinterestObservationWorkflowResult){if(this.#results.has(result.workflowId.value))throw new PinterestObservationWorkflowException("Workflow result is immutable","IMMUTABLE_WORKFLOW_RESULT");this.#results.set(result.workflowId.value,result);}
  result(id:PinterestObservationWorkflowId){return this.#results.get(id.value);}
  history(id:PinterestObservationWorkflowId){return Object.freeze((this.#history.get(id.value)??[]).map(x=>Object.freeze({...x,at:new Date(x.at)})));}
}
