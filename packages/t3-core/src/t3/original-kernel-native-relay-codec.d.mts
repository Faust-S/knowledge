export const ORIGINAL_NETWORK_RELAY_METHODS: Readonly<Record<string,string>>;
export function encodeOriginalNetworkRelayArgs(method:string,args:unknown[]):unknown[];
export function decodeOriginalNetworkRelayArgs(method:string,args:unknown[]):unknown[];
export function encodeOriginalNetworkRelayResult(method:string,value:unknown):unknown;
export function decodeOriginalNetworkRelayResult(method:string,value:unknown):unknown;
