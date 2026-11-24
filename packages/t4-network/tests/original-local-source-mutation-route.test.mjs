import test from "node:test";
import assert from "node:assert/strict";
import {createOriginalLocalSourceMutationRoute} from "../../t3-core/src/t3/original-local-source-mutation-route.mjs";
import {decodeOriginalNetworkRelayArgs} from "../../t3-core/src/t3/original-kernel-native-relay-codec.mjs";

const methods=["putObject","deleteObject","putAsset","deleteAsset","putRelation","deleteRelation"];
const negotiated={sessionId:"A".repeat(43),contextEpoch:9,networkRelayVersion:1,
  networkMethods:methods,localSourceMutationVersion:1,localSourceWorkspaceId:"ws:original",
  localSourceMutationMethods:methods};
const command={workspace_id:"ws:original",object_id:"o:1"};
const receipt={object:{workspace_id:"ws:original",object_id:"o:1"},event:{workspace_id:"ws:original"}};
const result={state:"ORIGINAL_SOURCE_MUTATION_CAPTURED",originalReceipt:receipt,
  captureRef:"t4:local:1",originalT3OutboxVerified:true,networkPublished:false};
const make=(originalKernelRelay=async()=>result,isHostActive=()=>true)=>
  createOriginalLocalSourceMutationRoute({workspaceId:"ws:original",originalKernelRelay,isHostActive});
const error=code=>({code});

test("configured source mutations require a complete exact original relay negotiation",async()=>{
  const route=make();
  await assert.rejects(route.route("putObject",[command]),error("T3_LOCAL_SOURCE_CAPTURE_BINDING_REQUIRED"));
  for(const bad of [{...negotiated,localSourceWorkspaceId:"foreign"},{...negotiated,localSourceMutationMethods:methods.slice(1)},
    {...negotiated,localSourceMutationVersion:0},{...negotiated,sessionId:"bad"}])
    assert.throws(()=>route.accept(bad),error("T3_LOCAL_SOURCE_CAPTURE_NEGOTIATION_INVALID"));
  route.accept(negotiated);
  assert.deepEqual(await route.route("putObject",[command]),{kind:"CAPTURED",originalReceipt:receipt});
});
test("all six original mutation commands use one relay; asset bytes and exact original receipt survive",async()=>{
  const calls=[];
  const route=make(async(verb,payload)=>{calls.push({verb,payload});return result;});
  route.accept(negotiated);
  for(const method of methods){
    const value=method==="putAsset"?{...command,bytes:new Uint8Array([0,255,128,17])}:command;
    assert.deepEqual(await route.route(method,[value]),{kind:"CAPTURED",originalReceipt:receipt});
    const call=calls.at(-1);
    assert.equal(call.verb,"sourceMutation");assert.equal(call.payload.sessionId,negotiated.sessionId);
    assert.equal(call.payload.method,method);
    assert.deepEqual(decodeOriginalNetworkRelayArgs(method,call.payload.args),[value]);
  }
  assert.equal(calls.length,6);
});
test("ordinary reads and another explicitly identified workspace never acquire source capture",async()=>{
  const route=make(async()=>assert.fail("unexpected relay"));
  assert.deepEqual(await route.route("getObject",["ws:original","o:1"]),{kind:"LOCAL_T3"});
  assert.deepEqual(await route.route("putObject",[{...command,workspace_id:"foreign"}]),{kind:"LOCAL_T3"});
});
test("unimplemented atomic and token-based mutations cannot bypass configured source capture",async()=>{
  const route=make(async()=>assert.fail("unexpected relay"));
  for(const method of ["commitObjectGraph","softDeleteWorkspace","restoreWorkspace","createWorkspace",
    "importCommit","purgeCommit","confirmExport"])
    await assert.rejects(route.route(method,[command]),error("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED"));
  await assert.rejects(route.route("importCommit",[{preview_token:"opaque",workspace_id:"foreign"}]),error("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED"));
  await assert.rejects(route.route("purgeCommit",[{purge_token:"opaque",workspace_id:"foreign"}]),error("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED"));
  await assert.rejects(route.route("confirmExport",[{workspace_ids:["ws:original"],workspace_id:"foreign"}]),error("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED"));
});
test("no automatic bypass or second operation after unknown, mode change or invalid receipt",async()=>{
  for(const [bad,code] of [[{state:"LOCAL_T3_BYPASS"},"T3_LOCAL_SOURCE_CAPTURE_MODE_CHANGED"],
    [{...result,originalT3OutboxVerified:false},"T3_LOCAL_SOURCE_CAPTURE_RECEIPT_INVALID"],
    [{...result,networkPublished:true},"T3_LOCAL_SOURCE_CAPTURE_RECEIPT_INVALID"]]){
    let calls=0;const route=make(async()=>{calls++;return bad;});route.accept(negotiated);
    await assert.rejects(route.route("putObject",[command]),error(code));assert.equal(calls,1);
  }
  const route=make(async()=>{throw Object.assign(Error("lost"),{code:"OUTCOME_UNKNOWN"});});
  route.accept(negotiated);
  await assert.rejects(route.route("putObject",[command]),error("OUTCOME_UNKNOWN"));
});
test("late receipt is not accepted after original binding disposal",async()=>{
  let finish,live=true;
  const route=make(()=>new Promise(resolve=>{finish=resolve;}),()=>live);
  route.accept(negotiated);
  const pending=route.route("putObject",[command]);
  route.clear();finish(result);
  await assert.rejects(pending,error("T3_LOCAL_SOURCE_CAPTURE_OUTCOME_UNKNOWN"));
  live=false;
  await assert.rejects(route.route("putObject",[command]),error("T3_HOST_DISPOSED"));
});

test("K21 negotiated original graph command remains one atomic relay request",async()=>{
  const graph={workspace_id:"ws:original",idempotency_key:"graph:original",
    object:{object_id:"o:1"},relation_puts:[{relation_id:"r:1"}],relation_deletes:[{relation_id:"r:2"}]};
  const methodsWithGraph=[...methods,"commitObjectGraph"];let calls=0;
  const route=make(async(verb,payload)=>{
    calls++;assert.equal(verb,"sourceMutation");assert.equal(payload.method,"commitObjectGraph");
    assert.deepEqual(payload.args,[graph]);return result;
  });
  route.accept({...negotiated,networkMethods:methodsWithGraph,localSourceMutationMethods:methodsWithGraph,localSourceGraphVersion:1});
  assert.deepEqual(await route.route("commitObjectGraph",[graph]),{kind:"CAPTURED",originalReceipt:receipt});
  assert.equal(calls,1);
  const old=make(async()=>assert.fail("old owner must not receive graph"));old.accept(negotiated);
  await assert.rejects(old.route("commitObjectGraph",[graph]),error("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED"));
});
