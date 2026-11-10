export interface SiteRestoreOptions {
  siteWindow: Window;
  hostUrl: string;
  onCandidate: (raw:string)=>void|{status:"APPLIED"|"NO_NEW_RESULTS"|"CANCELLED"};
  onStatus?: (status:string)=>void;
}
export function launchT2SiteRestore(options:SiteRestoreOptions):{
 dispose():void;readonly pending:boolean;readonly requested:boolean;
};
export interface HostRestoreOptions {
 hostWindow: Window;
 expectedSiteOrigin:string;
 onRequest?:()=>void;
 onStatus?:(status:string)=>void;
 cryptoSource?: Crypto;
}
export function mountT2SiteRestoreSender(options:HostRestoreOptions):{
 readonly requested:boolean;readonly sent:boolean;
 readonly acknowledgement:"APPLIED"|"CANCELLED"|"UNCHANGED"|"REJECTED"|null;
 dispose():void;send(raw:string):void;
};
