export const D05_SOURCE_PIN: Readonly<{repository:string;commit:string;tree:string;domain:string;version:string;}>;
export const D05_RESULT_TYPES: readonly string[];
export const D05_EVENT_TYPES: readonly string[];
export function createCehovodD05T3Bindings(): {
 objects:Array<{schema_id:string;schema_version:string;semantic_kind:'Result'}>;
 events:Array<{event_type:string;semantic_kind:'Event';epistemic_status:'reported'}>;
 relations:Array<{kind:'based_on';relation:'based_on'}>;
 context_events:string[];
};
export function createTrustedCehovodD05ReviewPort(config:{
 context:unknown;signedAccess:unknown;readActivityFromWorkspaceContext:Function;
 subscribeOwnerInvalidation:(listener:()=>void)=>(()=>void);
}): {
 readSelected:()=>Promise<unknown>;subscribeInvalidation:(listener:()=>void)=>(()=>void);
};
