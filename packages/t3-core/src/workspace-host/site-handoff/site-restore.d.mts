export interface SiteRestoreOptions {
  siteWindow: Window;
  hostUrl: string;
  onCandidate: (raw:string)=>void|{status:"APPLIED"|"NO_NEW_RESULTS"|"CANCELLED"|"REJECTED"}|
    Promise<void|{status:"APPLIED"|"NO_NEW_RESULTS"|"CANCELLED"|"REJECTED"}>;
  onStatus?: (status:string)=>void;
  /** Trusted site Kernel owner must re-read the saved exact Result. */
  verifyAppliedAfterRestore?: (raw:string, result:unknown)=>boolean|Promise<boolean>;
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
