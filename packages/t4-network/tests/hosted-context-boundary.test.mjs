import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlacementPolicy,createReplicaBinding,createSyncPlan,createContextProjection,assertT3SovereignAdditivity,T4HostedContextBoundaryError} from '../src/index.mjs';
const reject=(fn)=>assert.throws(fn,(e)=>e instanceof T4HostedContextBoundaryError);

test('placement policy enforces one write owner and no universal cloud master',()=>{
 const base={objectFamily:'notes',workspaceId:'w1',authorityRoot:'root-personal',writeOwnerRef:'owner:notes',writeOwnerRefs:['owner:notes'],primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['device:a','hosted:iwxa'],retentionClass:'owner-policy',recoveryClass:'standard',universalCloudMaster:false,subjectActionAuthority:false};
 const p=createPlacementPolicy(base); assert.equal(p.writeOwnerRef,'owner:notes'); assert.equal(p.universalCloudMaster,false);
 reject(()=>createPlacementPolicy({...base,writeOwnerRefs:['owner:notes','owner:cloud']}));
 reject(()=>createPlacementPolicy({...base,universalCloudMaster:true}));
 reject(()=>createPlacementPolicy({...base,subjectActionAuthority:true}));
});

test('replica cannot self-promote to owner or source truth',()=>{
 const base={replicaId:'r1',objectFamily:'notes',workspaceId:'w1',sourceOwnerRef:'owner:notes',locationRef:'hosted:iwxa',sourceVersion:'v7',replicaWriteOwner:false,sourceTruthAuthority:false,subjectActionAuthority:false};
 const r=createReplicaBinding(base); assert.equal(r.replicaWriteOwner,false); assert.equal(r.sourceTruthAuthority,false);
 reject(()=>createReplicaBinding({...base,replicaWriteOwner:true}));
 reject(()=>createReplicaBinding({...base,sourceTruthAuthority:true}));
});

test('sync requires explicit family conflict strategy and rejects generic silent LWW',()=>{
 const base={objectFamily:'notes',workspaceId:'w1',writeOwnerRef:'owner:notes',conflictStrategy:'OWNER_DECIDES',topologyDigest:'sha256:topology',syncIsAuthority:false,silentOwnerPromotion:false,genericSilentLww:false};
 assert.equal(createSyncPlan(base).syncIsAuthority,false);
 reject(()=>createSyncPlan({...base,genericSilentLww:true}));
 reject(()=>createSyncPlan({...base,conflictStrategy:'LWW_ALLOWED'}));
 assert.equal(createSyncPlan({...base,conflictStrategy:'LWW_ALLOWED',lwwSemanticallySafe:true}).conflictStrategy,'LWW_ALLOWED');
});

test('cross-core material is a purpose-bounded projection, not captured subject core',()=>{
 const base={projectionId:'p1',subjectCoreRef:'personal:peer-a',purpose:'role-admission-proof',sourceRefs:['e1'],rightsRef:'rights:minimal',writeOwner:false,subjectActionAuthority:false};
 const p=createContextProjection(base); assert.equal(p.writeOwner,false); assert.equal(p.subjectCoreRef,'personal:peer-a');
 reject(()=>createContextProjection({...base,writeOwner:true}));
 reject(()=>createContextProjection({...base,subjectActionAuthority:true}));
});

test('T4 remains additive and cannot become a prerequisite for T3 sovereign operation',()=>{
 const base={t3SovereignModePreserved:true,t4RequiredForT3Operation:false,t3ContextMustMoveRemote:false,t3OnlineIdentityRequired:false,t4OutageBreaksT3:false,hostedCapabilitiesAreOptionalForT3:true};
 const guard=assertT3SovereignAdditivity(base); assert.equal(guard.t3SovereignModePreserved,true);
 reject(()=>assertT3SovereignAdditivity({...base,t3SovereignModePreserved:false}));
 reject(()=>assertT3SovereignAdditivity({...base,t4RequiredForT3Operation:true}));
 reject(()=>assertT3SovereignAdditivity({...base,t3ContextMustMoveRemote:true}));
 reject(()=>assertT3SovereignAdditivity({...base,t3OnlineIdentityRequired:true}));
 reject(()=>assertT3SovereignAdditivity({...base,t4OutageBreaksT3:true}));
 reject(()=>assertT3SovereignAdditivity({...base,hostedCapabilitiesAreOptionalForT3:false}));
});
