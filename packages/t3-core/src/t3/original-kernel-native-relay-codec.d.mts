export const ORIGINAL_NETWORK_RELAY_METHODS: Readonly<Record<string,string>>;
export const ORIGINAL_REGISTRY_EXCHANGE_METHODS: Readonly<Record<string,string>>;
export function originalRegistryExchangeOperations(role:string):readonly string[];
export function encodeOriginalNetworkRelayArgs(method:string,args:unknown[]):unknown[];
export function decodeOriginalNetworkRelayArgs(method:string,args:unknown[]):unknown[];
export function encodeOriginalNetworkRelayResult(method:string,value:unknown):unknown;
export function decodeOriginalNetworkRelayResult(method:string,value:unknown):unknown;
export function readOriginalNativeRelayNegotiation(input:{reply:unknown;grantedOperations:readonly string[];
  session?:{sessionId:string;contextEpoch:number}|null}):Readonly<{state:"PENDING"|"READY"|"DENIED"|"LEGACY";networkMethods:readonly string[]}>;
