import { lazy, Suspense, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { OperationId } from "@/kernel-client";
import type { ViewerSurface } from "@/workspace-contract";
import type { ViewerRegistry } from "../registries/ViewerRegistry";
import { RendererBoundary, RendererErrorFallback } from "@/modules/base/features/workspace/RendererBoundary";
export interface HostViewerProps {registry:ViewerRegistry;profileId:string;schemaId:string;schemaVersion:string;surface:ViewerSurface;data:unknown;fallback:ReactNode;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];}
export function HostViewer(props:HostViewerProps){
 const found=props.registry.resolve({profileId:props.profileId,schemaId:props.schemaId,schemaVersion:props.schemaVersion,surface:props.surface},props.grantedOperations,props.activeCapabilities);
 const Lazy=useMemo(()=>found?lazy(found.load):null,[found?.entry.contributionId,found?.entry.ownerModuleId]);
 const [raw,setRaw]=useState(false);
 return <div data-testid="host-viewer" className="space-y-2">
 {props.surface==="detail"&&<div className="flex gap-2"><button type="button" onClick={()=>setRaw(false)} aria-pressed={!raw}>Представление</button><button type="button" onClick={()=>setRaw(true)} aria-pressed={raw}>Исходные данные</button></div>}
 {raw?<pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(props.data,null,2)}</pre>:Lazy?<RendererBoundary fallback={<RendererErrorFallback/>}><Suspense fallback={<p>Загрузка…</p>}><Lazy data={props.data} mode={props.surface==="detail"?"detail":"preview"}/></Suspense></RendererBoundary>:props.fallback}
 </div>;
}
