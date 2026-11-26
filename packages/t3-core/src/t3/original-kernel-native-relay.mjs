// D3: ephemeral transport between the ONE installed signed native owner and
// the ORIGINAL T2 KernelFacade in the existing trusted browser realm.
// It does not implement Kernel/Store, sign, authorize, persist, retry, or
// create a second Host. Native Reconciliation/SubjectBinding decides what to
// dispatch; this link carries only the already-authorized exact command.
import {randomBytes} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import {isDeepStrictEqual} from "node:util";
import {normalizeOriginalInstalledNetworkScope,sameOriginalInstalledNetworkScope} from "./original-installed-network-scope.mjs";
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";
import {ORIGINAL_NETWORK_RELAY_METHODS as NETWORK_METHODS,
  encodeOriginalNetworkRelayArgs,decodeOriginalNetworkRelayArgs,decodeOriginalNetworkRelayResult}
  from "./original-kernel-native-relay-codec.mjs";
const METHODS=Object.freeze({
  getWorkspace:"t1.getWorkspace",
  commitObjectGraph:"t1.commitObjectGraph",
  getObject:"t1.getObject",
  listEventsSince:"t1.listEventsSince",
});
const LOCAL_SOURCE_METHODS=new Set(['putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph']);
const CODE=/^[A-Z][A-Z0-9_]{4,99}$/;
const ID=value=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);
const registrySchema="iwxa.t3.access.signed-registry",registryEvent="t3.access.signed_registry.persisted";
const exactFields=(value,names)=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const clone=value=>structuredClone(value);
const validSession=s=>s&&typeof s==="object"&&!Array.isArray(s)&&
  s.contract_version==="1.3.0"&&
  typeof s.runtime_version==="string"&&s.runtime_version.length<80&&
  typeof s.service_id==="string"&&s.service_id.length<160&&
  Array.isArray(s.granted_operations)&&s.granted_operations.length<128&&
  s.granted_operations.every(x=>typeof x==="string"&&x.length<128);

// The installed T4 composition must bind its history receiver to the exact
// existing relay that owns the same native command slot. This process-local
// identity confers no authority and is never transmitted or persisted.
const relayNetworkOwners=new WeakMap();
export const isOriginalKernelNativeRelayForNetworkOwner=(relay,owner)=>
  owner!==null&&typeof owner==='object'&&relayNetworkOwners.get(relay)===owner;

const historyMethods=new Set(["listEventCommitWindow","listEventObjectCommitWindow"]);
const readPrerequisites=Object.freeze({listEventCommitWindow:"t1.listEventsSince",
  listEventObjectCommitWindow:"t1.listEventsSince",listObjectWindow:"t1.listObjects"});
function normalizeNetworkOwner(networkOwner){
  const networkNames=Array.isArray(networkOwner?.operations)?
    Object.keys(NETWORK_METHODS).filter(name=>
      networkOwner.operations.includes(NETWORK_METHODS[name])):[];
  check(!networkNames.includes("listObjectWindow")||
    (typeof networkOwner?.resolveOriginalAccess==="function"&&networkOwner.operations.includes("t1.listObjects")),
    "T3_ORIGINAL_NETWORK_RELAY_OBJECT_WINDOW_OWNER_REQUIRED");
  check(!networkNames.some(name=>historyMethods.has(name))||
    (typeof networkOwner?.resolveOriginalAccess==="function"&&
      networkOwner.operations.includes("t1.listEventsSince")),
    "T3_ORIGINAL_NETWORK_RELAY_COMMIT_HISTORY_OWNER_REQUIRED");
  check(networkOwner===null||(Array.isArray(networkOwner.operations)&&
    networkOwner.operations.length>0&&networkNames.length===networkOwner.operations.length&&
    ((typeof networkOwner.authorizeOperation==="function"&&networkOwner.resolveOriginalAccess===undefined)||
      (typeof networkOwner.resolveOriginalAccess==="function"&&networkOwner.authorizeOperation===undefined))&&
    typeof networkOwner.onAttach==="function"&&typeof networkOwner.onDetach==="function"&&
    (networkOwner.onIdleWake===undefined||typeof networkOwner.onIdleWake==="function")),
    "T3_ORIGINAL_NETWORK_RELAY_OWNER_REQUIRED");
  const localSource=networkOwner?.localSourceMutation??null;
  check(localSource===null||(typeof networkOwner.resolveOriginalAccess==="function"&&
    typeof localSource.workspaceId==="string"&&localSource.workspaceId.length>0&&
    Array.isArray(localSource.methods)&&localSource.methods.length>0&&
    new Set(localSource.methods).size===localSource.methods.length&&
    localSource.methods.every(name=>LOCAL_SOURCE_METHODS.has(name)&&networkNames.includes(name))&&
    typeof localSource.invoke==="function"),"T3_ORIGINAL_LOCAL_SOURCE_MUTATION_OWNER_REQUIRED");
  const history=networkOwner?.readOriginalReplacementOwnerHistory??null;
  check(history===null||(networkOwner.originalSignedReplacementHistoryBound===true&&
    typeof networkOwner.resolveOriginalAccess==='function'&&typeof history==='function'),
    "T3_ORIGINAL_REPLACEMENT_HISTORY_OWNER_REQUIRED");
  return networkOwner===null?null:Object.freeze({
    names:Object.freeze([...networkNames]),authorize:networkOwner.authorizeOperation,
    resolveAccess:networkOwner.resolveOriginalAccess,
    attach:networkOwner.onAttach,detach:networkOwner.onDetach,wake:networkOwner.onIdleWake,history,
    localSource:localSource===null?null:Object.freeze({workspaceId:localSource.workspaceId,
      methods:Object.freeze([...localSource.methods]),invoke:localSource.invoke}),
  });
}

export function createOriginalKernelNativeRelay({
  currentEpoch,onAttach,onDetach=()=>{},timeoutMs=20000,
  idleLeaseMs=30000,networkOwner=null,originalRegistryScope=null,networkActivation=null,
}={}){
  check(typeof currentEpoch==="function"&&typeof onAttach==="function"&&
    typeof onDetach==="function"&&Number.isSafeInteger(timeoutMs)&&
    timeoutMs>=1000&&timeoutMs<=60000&&
    Number.isSafeInteger(idleLeaseMs)&&idleLeaseMs>=1000&&idleLeaseMs<=120000,
    "T3_D3_ORIGINAL_KERNEL_RELAY_HOST_REQUIRED");
  // The compatibility route keeps the original static owner. An installed
  // product may instead opt into admission after the existing realm polls.
  const network=normalizeNetworkOwner(networkOwner);
  check(networkActivation===null||(networkOwner===null&&originalRegistryScope!==null&&
    ['SOURCE','RECIPIENT'].includes(networkActivation.role)&&ID(networkActivation.sourceWorkspaceId)&&
    ID(networkActivation.technicalWorkspaceId)&&typeof networkActivation.createProfile==="function"&&
    typeof networkActivation.bindPeerHistoryReceiver==="function"&&
    new Set([networkActivation.sourceWorkspaceId,networkActivation.technicalWorkspaceId,originalRegistryScope.workspaceId]).size===3),
    "T3_ORIGINAL_NETWORK_ACTIVATION_CONFIGURATION_INVALID");
  const activation=networkActivation===null?null:Object.freeze({role:networkActivation.role,
    sourceWorkspaceId:networkActivation.sourceWorkspaceId,technicalWorkspaceId:networkActivation.technicalWorkspaceId,
    createProfile:networkActivation.createProfile,bindPeerHistoryReceiver:networkActivation.bindPeerHistoryReceiver,
    installedScope:networkActivation.installedScope===undefined?null:normalizeOriginalInstalledNetworkScope(networkActivation.installedScope)});
  if(activation?.installedScope)check(activation.installedScope.role===activation.role&&
    activation.installedScope.sourceWorkspaceId===activation.sourceWorkspaceId&&
    activation.installedScope.technicalWorkspaceId===activation.technicalWorkspaceId&&
    activation.installedScope.registryWorkspaceId===originalRegistryScope.workspaceId,
    "T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_MISMATCH");
  check(originalRegistryScope===null||(ID(originalRegistryScope.workspaceId)&&ID(originalRegistryScope.objectId)&&
    originalRegistryScope.workspaceId!==network?.localSource?.workspaceId),"T3_ORIGINAL_REGISTRY_RELAY_SCOPE_INVALID");
  const registryScope=originalRegistryScope===null?null:Object.freeze({workspaceId:originalRegistryScope.workspaceId,objectId:originalRegistryScope.objectId});
  const registryContext=registryScope?new AsyncLocalStorage():null;
  let live=null,pending=null,closed=false,nextId=1,attaching=null;
  let reservation=null,wakeTask=null,localSourceTask=null,historyTask=null;
  let registryCommand=null,activationTask=null;
  const liveState=state=>!closed&&live===state&&attaching!==state;
  const registryBusy=()=>registryCommand!==null;
  // Only the exact currently executing native task may borrow the same
  // command slot for the Registry's bounded technical reads. A detached
  // async continuation never inherits a usable lease.
  const withRegistryReads=async(state,active,run,held=null)=>{
    if(!registryContext)return run();
    const parent=registryContext.getStore();
    check(!parent||(parent.state===state&&parent.active()),"T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED");
    let open=true;
    const lease={state,held,active:()=>open&&active()&&(!parent||parent.active())};
    try{return await registryContext.run(lease,run);}finally{open=false;}
  };
  const networkActive=state=>!closed&&live===state&&state.networkReady===true;
  const networkCleanup=state=>{
    if(!state)return;
    state.networkReady=false;state.localSourceReady=false;
    if(state.networkStarted){
      state.networkStarted=false;
      try{state.network.detach({contextEpoch:state.epoch,sessionId:state.sessionId});}
      catch{/* never restore an invalidated binding */}
    }
    if(state.profile){
      const profile=state.profile;state.profile=null;
      try{state.stopPeerHistory?.();}catch{/* close the profile regardless */}
      state.stopPeerHistory=null;
      if(relayNetworkOwners.get(relay)===profile.networkOwner)relayNetworkOwners.delete(relay);
      try{profile.close();}catch{/* never restore an invalidated binding */}
    }
  };
  // Exactly one pending HTTP long-poll on the original Control. The signed
  // native owner can wake it immediately instead of waiting for hidden
  // WebView timer callbacks (which Windows/WebView2 may throttle).
  let idlePoll=null,idleLeaseTimer=null;
  const wakePoll=()=>{
    const wake=idlePoll;idlePoll=null;
    wake?.();
  };
  const detach=reason=>{
    if(idleLeaseTimer!==null){
      clearTimeout(idleLeaseTimer);idleLeaseTimer=null;
    }
    const prior=live;
    live=null;reservation=null;
    wakePoll();
    if(pending){
      const call=pending;pending=null;
      clearTimeout(call.timer);
      call.reject(Object.assign(Error(reason),{code:reason}));
    }
    networkCleanup(prior);
    if(prior){try{onDetach();}catch{/* never restore a stale Host */}}
  };
  // The existing browser "next" long-poll renews this native session lease.
  // Pagehide/SSE may be lost when WebView2 terminates unexpectedly; without
  // a bounded idle lifetime Center could advertise an absent APPLY owner.
  const renewIdleLease=()=>{
    if(idleLeaseTimer!==null)clearTimeout(idleLeaseTimer);
    idleLeaseTimer=setTimeout(()=>{
      idleLeaseTimer=null;
      if(!live||closed)return;
      // After original graph dispatch a write may have committed, even if
      // the browser vanished before returning the original receipt.
      detach(pending?.issued&&(["commitObjectGraph","putObject","deleteObject","putAsset","deleteAsset","putRelation","deleteRelation"].includes(pending.method))
        ?"T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN"
        :"T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
    },idleLeaseMs);
    idleLeaseTimer.unref?.();
  };
  const same=(token,epoch)=>{
    check(!closed&&live&&token===live.sessionId&&epoch===live.epoch,
      "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
  };
  const kernelFor=(epoch,grants,sessionId)=>Object.freeze({
    sessionInfo:Object.freeze({
      contract_version:"1.3.0",runtime_version:grants.runtime_version,
      service_id:grants.service_id,mode:grants.mode??"unknown",
    }),
    hasOperation:id=>Object.values(METHODS).includes(id)&&
      grants.granted_operations.includes(id),
    commitObjectGraph:input=>dispatch("commitObjectGraph",[input],epoch,sessionId),
    getWorkspace:ws=>dispatch("getWorkspace",[ws],epoch,sessionId),
    getObject:(ws,obj)=>dispatch("getObject",[ws,obj],epoch,sessionId),
    listEventsSince:(ws,since)=>dispatch("listEventsSince",[ws,since],epoch,sessionId),
  });
  const dispatch=(method,args,epoch,sessionId)=>{
    check(!closed&&live&&live.epoch===epoch&&live.sessionId===sessionId&&
      live.grants.granted_operations.includes(METHODS[method]),
      "T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED");
    // Native D3 cannot silently produce an uncaptured source graph while
    // an explicit local-capture owner is installed. Ordinary D3 outside this
    // one source workspace remains the inherited T3 route.
    const captureWorkspace=activation?.role==='SOURCE'?activation.sourceWorkspaceId:live.network?.localSource?.workspaceId;
    check(!(method==="commitObjectGraph"&&captureWorkspace&&args[0]?.workspace_id===captureWorkspace),
      "T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED");
    check(!(method==="commitObjectGraph"&&registryScope&&args[0]?.workspace_id===registryScope.workspaceId),
      "T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED");
    check(!(method==="commitObjectGraph"&&activation&&(args[0]?.workspace_id===activation.technicalWorkspaceId||
      (activation.role==='RECIPIENT'&&args[0]?.workspace_id===activation.sourceWorkspaceId))),
      "T3_ORIGINAL_NETWORK_OWNER_WRITE_REQUIRED");
    check(pending===null&&reservation===null&&localSourceTask===null&&historyTask===null&&activationTask===null&&
      !registryBusy()&&(!registryScope||wakeTask===null)&&live.activationRequest===null&&live.activationAnnouncement===null,
      "T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    return enqueue(method,args,false);
  };
  const enqueue=(method,args,networkCommand)=>{
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(pending?.id!==id)return;
        // After a lost response, the original T2 graph may already have
        // committed. Never retry the command or reuse this uncertain realm.
        detach("T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN");
      },timeoutMs);
      timer.unref?.();
      pending={id,method,args:clone(args),networkCommand,issued:false,timer,resolve,reject};
      wakePoll();
    });
  };
  // The only direct commands used by the original signed Registry itself.
  // They are constrained to a separately pinned technical Workspace/Object;
  // no raw business read, nested graph write, or extra command queue exists.
  const registryDispatch=async(state,method,args)=>{
    const exact=clone(args),scope=registryScope,lease=registryContext?.getStore();
    check(scope&&liveState(state)&&state.kernel.hasOperation(METHODS[method]),"T3_ORIGINAL_REGISTRY_RELAY_NOT_CONNECTED");
    const write=method==="commitObjectGraph",first=exact[0];
    check(method==="getObject"?(exact.length===2&&first===scope.workspaceId&&exact[1]===scope.objectId):
      method==="listEventsSince"?(exact.length===1&&first===scope.workspaceId):
      write&&exact.length===1&&exactFields(first,["workspace_id","idempotency_key","object","event"])&&
      first.workspace_id===scope.workspaceId&&exactFields(first.object,["object_id","schema_id","schema_version","base_revision","data","extensions"])&&
      first.object.object_id===scope.objectId&&first.object.schema_id===registrySchema&&first.object.schema_version==="1.0.0"&&
      exactFields(first.event,["event_type","payload"])&&first.event.event_type===registryEvent&&first.event.payload?.object_id===scope.objectId,
      "T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED");
    const active=()=>liveState(state)&&(lease?lease.state===state&&lease.active()&&
      (reservation===null||lease.held===reservation):reservation===null&&wakeTask===null&&localSourceTask===null&&historyTask===null&&activationTask===null&&
      state.activationRequest===null&&state.activationAnnouncement===null);
    check(!write||!lease,"T3_ORIGINAL_REGISTRY_RELAY_NESTED_WRITE_DENIED");
    check(active(),"T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED");
    check(pending===null&&!registryBusy(),"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    const held={};registryCommand=held;
    const requireCurrent=async()=>check(await currentEpoch()===state.epoch&&active()&&registryCommand===held,
      "T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED");
    try{
      await requireCurrent();
      check(pending===null,"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
      const result=await enqueue(method,exact,false);
      await requireCurrent();
      return result;
    }finally{if(registryCommand===held)registryCommand=null;}
  };
  const registryKernelFor=state=>Object.freeze({sessionInfo:state.kernel.sessionInfo,
    hasOperation:id=>liveState(state)&&[METHODS.getObject,METHODS.listEventsSince,METHODS.commitObjectGraph].includes(id)&&state.kernel.hasOperation(id),
    getObject:(...args)=>registryDispatch(state,"getObject",args),
    listEventsSince:(...args)=>registryDispatch(state,"listEventsSince",args),
    commitObjectGraph:(...args)=>registryDispatch(state,"commitObjectGraph",args),
  });
  const networkDispatch=async(state,method,args)=>{
    const network=state.network;
    check(networkActive(state)&&attaching!==state&&network.names.includes(method),
      "T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED");
    check(pending===null&&reservation===null&&!registryBusy(),"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    // A delayed callback from a completed task cannot obtain a fresh native
    // reservation or compete with the current admitted owner task.
    const caller=registryContext?.getStore();
    check(!registryScope||(caller?caller.state===state&&caller.active():!wakeTask&&!historyTask&&!localSourceTask&&!activationTask),
      "T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED");
    if(Object.hasOwn(readPrerequisites,method))check(network.resolveAccess&&
      state.grants.granted_operations.includes(readPrerequisites[method])&&
      state.grants.granted_operations.includes(NETWORK_METHODS[method]),
      "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
    const held={};reservation=held;
    try{return await withRegistryReads(state,()=>networkActive(state)&&reservation===held,async()=>{
      // Snapshot BEFORE asynchronous authorization. The owner sees exactly
      // the arguments that will reach the original Kernel, not UI metadata.
      const exact=clone(args);
      const operation=NETWORK_METHODS[method];
      check(await currentEpoch()===state.epoch&&networkActive(state),
        "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      const proof=Object.freeze({operation,method,args:clone(exact),
        sessionId:state.sessionId,contextEpoch:state.epoch,
        originalKernelOperation:true,networkGrantsNoWriteAuthority:true});
      const active=()=>networkActive(state)&&reservation===held&&(!caller||caller.active());
      const requireCurrent=async()=>{
        check(await currentEpoch()===state.epoch&&active(),
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      };
      const invoke=async()=>{
        await requireCurrent();
        check(pending===null&&!registryBusy(),"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
        return enqueue(method,encodeOriginalNetworkRelayArgs(method,exact),true);
      };
      if(network.resolveAccess){
        // The existing signed T3 binding, not a second permission evaluator,
        // owns the exact command and validates the REAL original receipt.
        // A remote frame cannot select a grant or call the underlying relay.
        const access=await network.resolveAccess(proof);
        await requireCurrent();
        check(access!==null&&access!==undefined,
          "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
        let invoked=false;
        const normalize=items=>{
          const list=[...items];
          while(list.length&&list.at(-1)===undefined)list.pop();
          return list;
        };
        const original=Object.freeze({
          sessionInfo:state.kernel.sessionInfo,
          hasOperation:id=>active()&&state.grants.granted_operations.includes(id)&&
            (id===operation||(Object.hasOwn(readPrerequisites,method)&&id===readPrerequisites[method])),
          [method]:async(...checkedArgs)=>{
            check(!invoked&&isDeepStrictEqual(normalize(checkedArgs),normalize(exact)),
              "T3_ORIGINAL_NETWORK_RELAY_AUTHORIZED_COMMAND_MISMATCH");
            invoked=true;
            return invoke();
          },
        });
        const signed=createSubjectKernelBinding({kernel:original,access,isHostActive:active});
        const result=await signed[method](...clone(exact));
        check(invoked,"T3_ORIGINAL_NETWORK_RELAY_AUTHORIZED_COMMAND_MISSING");
        await requireCurrent();
        return result;
      }
      // Compatibility for the existing trusted owner callback. The signed
      // native product route above always uses the actual T3 Access owner.
      check(await network.authorize(proof)===true,
        "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
      return await invoke();
    },held);}finally{if(reservation===held)reservation=null;}
  };
  const networkPort=state=>{
    const network=state.network;
    return Object.freeze({
    sessionInfo:state.kernel.sessionInfo,
    authorityMode:network.resolveAccess?"ORIGINAL_T3_SIGNED":"EXTERNAL_ORIGINAL_OWNER",
    // Capability discovery is available while the owner constructs its
    // original task binding; no command may execute before admission.
    hasOperation:id=>!closed&&live===state&&state.networkStarted&&
      state.grants.granted_operations.includes(id)&&
      network.names.some(name=>NETWORK_METHODS[name]===id&&
        (!Object.hasOwn(readPrerequisites,name)||(typeof network.resolveAccess==="function"&&
          state.grants.granted_operations.includes(readPrerequisites[name])))),
    ...Object.fromEntries(network.names.map(name=>[name,(...args)=>networkDispatch(state,name,args)])),
  });};
  // Driven by the existing browser next/lease, never an extra timer or queue.
  // Do not await the callback in next(): its Kernel command must wake this poll.
  const startNetworkWake=state=>{
    if(!networkActive(state)||attaching===state||!state.network.wake||wakeTask||localSourceTask||historyTask||pending||reservation||registryBusy()||activationTask)return;
    const network=state.network;
    const task={state};wakeTask=task;
    task.done=Promise.resolve().then(async()=>{
      if(networkActive(state))await withRegistryReads(state,()=>networkActive(state)&&wakeTask===task,()=>network.wake(Object.freeze({
        kernel:state.networkKernel,contextEpoch:state.epoch,sessionId:state.sessionId,
        isHostActive:()=>networkActive(state),
      })));
    }).catch(()=>{
      // Stop this binding on an unclassified failure. The original owner
      // must inspect durable evidence on a new binding, not repeat a write.
      networkCleanup(state);
    }).finally(()=>{if(wakeTask===task)wakeTask=null;});
  };
  const negotiated=(state,admitted)=>({sessionId:state.sessionId,contextEpoch:state.epoch,
    ...(admitted?{networkRelayVersion:1,networkMethods:[...state.network.names]}:{}),
    ...(state.localSourceReady?{localSourceMutationVersion:1,localSourceWorkspaceId:state.network.localSource.workspaceId,
      localSourceMutationMethods:[...state.localSourceMethods],
      ...(state.localSourceMethods.includes('commitObjectGraph')?{localSourceGraphVersion:1}:{})}:{})});
  const configureLocalSource=(state,request,admitted)=>{
    state.localSourceReady=admitted&&request.localSourceMutationVersion===1&&state.network.localSource!==null;
    state.localSourceMethods=state.localSourceReady?state.network.localSource.methods.filter(m=>
      m!=='commitObjectGraph'||request.localSourceGraphVersion===1):[];
  };
  // A genuine Registry read cannot complete during attach: the browser has
  // no session token and cannot yet poll the command slot. Use the EXISTING
  // next/result loop, then announce admission once. No network frame, second
  // scheduler, retry loop, or subject operation is introduced here.
  const startNetworkActivation=state=>{
    if(!activation||!state.activationRequest||!liveState(state)||activationTask||pending||reservation||wakeTask||localSourceTask||historyTask||registryBusy())return;
    const request=state.activationRequest;state.activationRequest=null;
    const task={state};activationTask=task;
    const active=()=>liveState(state)&&activationTask===task;
    const requireCurrent=async()=>check(await currentEpoch()===state.epoch&&active(),"T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
    void Promise.resolve().then(async()=>{
      let profile=null,admitted=false;
      try{
        await withRegistryReads(state,active,async()=>{
          await requireCurrent();
          profile=await activation.createProfile(Object.freeze({registryKernel:state.registryKernel,
            sessionId:state.sessionId,contextEpoch:state.epoch,isHostActive:()=>liveState(state)}));
          await requireCurrent();
          check(profile?.schema==='IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_PROFILE_V1'&&profile.role===activation.role&&
            typeof profile.close==='function'&&typeof profile.bindOriginalPeerHistoryReceiver==='function'&&
            typeof profile.networkOwner?.resolveOriginalAccess==='function'&&profile.networkOwner.role===activation.role&&
            profile.networkOwner.identity?.sourceWorkspaceId===activation.sourceWorkspaceId&&
            profile.networkOwner.identity?.technicalWorkspaceId===activation.technicalWorkspaceId,"T3_ORIGINAL_NETWORK_ACTIVATION_PROFILE_REQUIRED");
          const selected=normalizeNetworkOwner(profile.networkOwner);
          check(selected.names.every(name=>state.grants.granted_operations.includes(NETWORK_METHODS[name]))&&
            (activation.role==='SOURCE'?(selected.localSource?.workspaceId===activation.sourceWorkspaceId&&
              request.localSourceMutationVersion===1&&request.localSourceGraphVersion===1):selected.localSource===null)&&
            typeof selected.history==='function',"T3_ORIGINAL_NETWORK_ACTIVATION_OPERATIONS_REQUIRED");
          state.profile=profile;profile=null;state.network=selected;
          relayNetworkOwners.set(relay,state.profile.networkOwner);
          state.networkStarted=true;state.networkKernel=networkPort(state);
          const installed=await selected.attach(Object.freeze({kernel:state.networkKernel,contextEpoch:state.epoch,
            sessionId:state.sessionId,isHostActive:()=>networkActive(state)}));
          // A detach during asynchronous onAttach may have disposed the
          // prior owner before its late binding existed. Close that binding.
          if(!active()){try{selected.detach({contextEpoch:state.epoch,sessionId:state.sessionId});}catch{};fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");}
          check(installed===true,"T3_ORIGINAL_NETWORK_ACTIVATION_DENIED");
          await requireCurrent();
          const receiver=state.profile.bindOriginalPeerHistoryReceiver(relay);
          const stop=await activation.bindPeerHistoryReceiver(receiver);
          check(typeof stop==='function',"T3_ORIGINAL_NETWORK_ACTIVATION_PEER_REQUIRED");
          if(!active()){try{stop();}catch{};fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");}
          state.stopPeerHistory=stop;
          await requireCurrent();
          configureLocalSource(state,request,true);admitted=true;
        });
      }catch{
        try{profile?.close?.();}catch{};
        networkCleanup(state);
      }finally{
        if(activationTask===task)activationTask=null;
        if(liveState(state)){
          state.activationAnnouncement={kind:"NETWORK_ACTIVATION",activation:{networkActivationVersion:1,
            state:admitted?"READY":"DENIED",...negotiated(state,admitted)}};
          wakePoll();
        }
      }
    });
  };
  const takeActivation=state=>{
    const announcement=state.activationAnnouncement;
    if(!announcement)return null;
    state.activationAnnouncement=null;
    state.networkReady=announcement.activation.state==='READY';
    return announcement;
  };
  const relay=Object.freeze({
    // An uncompleted native attach must never advertise an APPLY-capable
    // Kernel to the installed owner, even before its epoch is rechecked.
    get attached(){return !closed&&live!==null&&attaching!==live;},
    get networkAttached(){return !!live&&attaching!==live&&networkActive(live);},
    get nativeKernel(){return !closed&&live&&attaching!==live?live.kernel:null;},
    get nativeRegistryKernel(){return registryScope&&live&&liveState(live)?live.registryKernel:null;},
    // Installed original owner only. Never an exchange verb exposed to the
    // browser or to a remote frame. Non-blocking reservation of the SAME
    // command slot prevents simultaneous peer recovery from deadlocking.
    ...(network?.history||activation?{async readOriginalReplacementOwnerHistory(input){
      const state=live;
      if(!state||!networkActive(state)||attaching===state||!state.network.history||wakeTask||localSourceTask||historyTask||pending||reservation||registryBusy()||activationTask)return null;
      const network=state.network;
      const exact=clone(input),task={state};historyTask=task;
      try{
        if(await currentEpoch()!==state.epoch||!networkActive(state))return null;
        const result=await withRegistryReads(state,()=>networkActive(state)&&historyTask===task,()=>network.history(exact));
        check(await currentEpoch()===state.epoch&&networkActive(state)&&historyTask===task,
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        return clone(result);
      }finally{if(historyTask===task)historyTask=null;}
    }}:{}),
    invalidate(){detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");},
    close(){closed=true;detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");},
    async exchange({verb,payload}={},requestEpoch){
      check(!closed&&Number.isSafeInteger(requestEpoch)&&
        requestEpoch>=0,"T3_D3_ORIGINAL_KERNEL_EPOCH_INVALID");
      if(await currentEpoch()!==requestEpoch){
        detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      }
      if(verb==="attach"){
        if(activation?.installedScope)check(payload?.networkActivationVersion===1&&payload.networkRelayVersion===1&&
          sameOriginalInstalledNetworkScope(activation.installedScope,payload.installedNetworkScope)&&
          (activation.role!=='SOURCE'||(payload.localSourceMutationVersion===1&&payload.localSourceGraphVersion===1)),
          "T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_MISMATCH");
        // The old onAttach may still be completing after a detach. Do not let
        // a new session race the native owner while its previous binding is
        // being installed or torn down.
        check(attaching===null&&wakeTask===null&&localSourceTask===null&&historyTask===null&&activationTask===null&&!registryBusy(),"T3_D3_ORIGINAL_KERNEL_ATTACH_IN_PROGRESS");
        check(!live&&validSession(payload?.sessionInfo),
          "T3_D3_ORIGINAL_KERNEL_SESSION_INVALID");
        const grants=clone(payload.sessionInfo);
        // Read-only Workspace preflight is part of the SAME native D3
        // apply transaction. Never advertise an APPLY-capable binding that
        // cannot prove its target exists before independent Human consent.
        check(["commitObjectGraph","getWorkspace","getObject",
          "listEventsSince"].every(
          name=>grants.granted_operations.includes(METHODS[name])),
          "T3_D3_ORIGINAL_KERNEL_OPERATIONS_REQUIRED");
        const epoch=requestEpoch,sessionId=randomBytes(32).toString("base64url");
        const kernel=kernelFor(epoch,grants,sessionId);
        const state={epoch,sessionId,grants,kernel,network,networkReady:false,networkStarted:false,localSourceReady:false,
          registryKernel:null,activationRequest:null,activationAnnouncement:null,profile:null,stopPeerHistory:null};
        if(registryScope)state.registryKernel=registryKernelFor(state);
        live=state;
        attaching=state;
        try{
          check(await onAttach(kernel)===true,
            "T3_D3_ORIGINAL_KERNEL_OWNER_ATTACH_FAILED");
          if(await currentEpoch()!==epoch||live!==state)
            fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          if(network&&payload.networkRelayVersion===1&&
            network.names.every(name=>grants.granted_operations.includes(NETWORK_METHODS[name]))){
            state.networkStarted=true;
            state.networkKernel=networkPort(state);
            let admitted=false;
            try{admitted=await network.attach(Object.freeze({
              kernel:state.networkKernel,contextEpoch:epoch,sessionId,
              isHostActive:()=>networkActive(state),
            }))===true;}catch{/* network opt-in does not disable original D3 */}
            if(await currentEpoch()!==epoch||live!==state){
              // A late owner attach after detach may have created a binding.
              state.networkStarted=true;networkCleanup(state);
              fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
            }
            state.networkReady=admitted;
            configureLocalSource(state,payload,admitted);
            if(!admitted)networkCleanup(state);
          }
          if(activation&&payload.networkRelayVersion===1&&payload.networkActivationVersion===1)
            state.activationRequest=Object.freeze({localSourceMutationVersion:payload.localSourceMutationVersion,localSourceGraphVersion:payload.localSourceGraphVersion});
          renewIdleLease();
          return {...negotiated(state,state.networkReady),...(state.activationRequest?{networkActivationPending:1}:{})};
        }catch(error){
          if(live===state)detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          else{
            // A detach while onAttach was pending may have run BEFORE the
            // original native owner finished installing its binding. Close
            // that late binding now, before a replacement can be admitted.
            try{onDetach();}catch{/* never restore a stale Host */}
          }
          throw error;
        }finally{
          if(attaching===state)attaching=null;
        }
      }
      same(payload?.sessionId,requestEpoch);
      if(verb==="sourceMutation"){
        // This is an original local user operation, never a remote frame.
        // It shares the EXISTING authenticated native relay and its one
        // original execution slot. No scheduler, second queue or raw grants.
        const state=live,network=state.network;
        check(networkActive(state)&&state.localSourceReady===true&&attaching!==state&&
          state.localSourceMethods.includes(payload?.method)&&Array.isArray(payload?.args)&&
          payload.args.length===1,
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE");
        // Reserve the one local operation before awaiting the EXISTING
        // in-flight wake. No next wake can overtake this user command.
        // Do not admit a second user command or compete with native D3.
        const currentWake=wakeTask;
        check(localSourceTask===null&&historyTask===null&&activationTask===null&&(currentWake!==null||pending===null&&reservation===null&&!registryBusy()),
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY");
        const method=payload.method;
        const exact=clone(decodeOriginalNetworkRelayArgs(method,payload.args));
        check(exact[0]&&typeof exact[0]==="object"&&
          exact[0].workspace_id===network.localSource.workspaceId,
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_SCOPE_DENIED");
        const task={state};localSourceTask=task;
        try{
          if(currentWake!==null)await currentWake.done;
          check(await currentEpoch()===state.epoch&&networkActive(state)&&localSourceTask===task,
            "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          check(pending===null&&reservation===null&&!registryBusy(),"T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY");
          const result=await withRegistryReads(state,()=>networkActive(state)&&localSourceTask===task,()=>network.localSource.invoke(Object.freeze({
            method,args:exact,contextEpoch:state.epoch,sessionId:state.sessionId,
            kernel:state.networkKernel,isHostActive:()=>networkActive(state),
          })));
          check(await currentEpoch()===state.epoch&&networkActive(state),
            "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_OUTCOME_UNKNOWN");
          check(result?.state==="LOCAL_T3_BYPASS"||
            (result?.state==="ORIGINAL_SOURCE_MUTATION_CAPTURED"&&result.originalReceipt!=null),
            "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_RESULT_INVALID");
          return clone(result);
        }finally{if(localSourceTask===task)localSourceTask=null;}
      }
      if(verb==="next"){
        renewIdleLease();
        // A single bounded pending request replaces 200-ms browser polling.
        // HTTP requestTimeout is 15s in the existing original Control Host;
        // this wait is 5s and never outlives its session.
        if(!pending){
          check(idlePoll===null,
            "T3_D3_ORIGINAL_KERNEL_POLL_IN_PROGRESS");
          const announcement=takeActivation(live);
          if(announcement)return announcement;
          if(live.activationRequest)startNetworkActivation(live);else startNetworkWake(live);
          await new Promise(resolve=>{
            const done=()=>{
              clearTimeout(timer);resolve();
            };
            const timer=setTimeout(()=>{
              if(idlePoll===done)idlePoll=null;
              done();
            },5000);
            timer.unref?.();
            idlePoll=done;
          });
          same(payload?.sessionId,requestEpoch);
          if(await currentEpoch()!==requestEpoch){
            detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
            fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          }
        }
        // A detach/re-attach at the SAME epoch during an async poll check
        // must not deliver the replacement session's command to the old realm.
        same(payload?.sessionId,requestEpoch);
        if(!pending){const announcement=takeActivation(live);if(announcement)return announcement;}
        if(!pending||pending.issued)return {kind:"IDLE"};
        if(pending.networkCommand&&!networkActive(live)){
          const call=pending;pending=null;clearTimeout(call.timer);
          call.reject(Object.assign(Error("T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"),
            {code:"T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"}));
          return {kind:"IDLE"};
        }
        pending.issued=true;
        return {kind:"COMMAND",id:pending.id,method:pending.method,
          args:clone(pending.args)};
      }
      if(verb==="result"){
        check(pending&&pending.issued&&
          payload?.id===pending.id&&
          (payload.ok===true||payload.ok===false),
          "T3_D3_ORIGINAL_KERNEL_RESULT_UNEXPECTED");
        const call=pending;pending=null;
        clearTimeout(call.timer);
        if(payload.ok===true){
          try{call.resolve(clone(call.networkCommand?
            decodeOriginalNetworkRelayResult(call.method,payload.result):payload.result));}
          catch{call.reject(Object.assign(
            Error("T3_D3_ORIGINAL_KERNEL_RESULT_INVALID"),
            {code:"T3_D3_ORIGINAL_KERNEL_RESULT_INVALID"}));}
        }else{
          const code=CODE.test(payload?.code??"")?payload.code:
            "T3_D3_ORIGINAL_KERNEL_RESULT_DENIED";
          call.reject(Object.assign(Error(code),{code}));
        }
        renewIdleLease();
        return {accepted:true};
      }
      if(verb==="detach"){
        detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        return {detached:true};
      }
      fail("T3_D3_ORIGINAL_KERNEL_RELAY_VERB_INVALID");
    },
  });
  if(networkOwner!==null)relayNetworkOwners.set(relay,networkOwner);
  return relay;
}
