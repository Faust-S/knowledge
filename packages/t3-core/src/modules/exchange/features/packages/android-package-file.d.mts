export function isAndroidPackageFileRuntime(scope?:unknown):boolean;
export function saveAndroidPackageFile(bytes:Uint8Array,filename:string,options?:{
  scope?:unknown;isCurrent?:()=>boolean;
}):Promise<Readonly<{filename:string;filenameConfirmed:boolean;bytes:number;sha256:string}>>;
export function androidPackageFileMessage(error:unknown):string;
