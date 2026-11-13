// Original IWXA T3 organizational product contracts, adopted in ONE executable Access tree inside knowledge.
// GENERATED from single field specification in source qualification. Contract validation only; never an authorization decision.
import { copy as strictCopy } from './core.mjs';

const SPECS={
  "PersonalSubjectProfile": {
    "schema": "IWXA_T3_PERSONAL_SUBJECT_PROFILE/1",
    "fields": {
      "personId": "id",
      "personalDataRootId": "id",
      "personalPublicKeyRefs": "ids",
      "createdAt": "utc"
    }
  },
  "OrganizationIdentity": {
    "schema": "IWXA_T3_ORGANIZATION_IDENTITY/1",
    "fields": {
      "organizationId": "id",
      "realmId": "id",
      "issuerAuthorityId": "id",
      "organizationDataRootId": "id",
      "membershipEpoch": "integer",
      "issuerPublicKeyRefs": "nonemptyIds",
      "createdAt": "utc"
    }
  },
  "ManagedWorkspace": {
    "schema": "IWXA_T3_MANAGED_WORKSPACE/1",
    "fields": {
      "workspaceId": "id",
      "organizationId": "id",
      "ownerDataRootId": "id",
      "classification": "enum:INTERNAL|CONFIDENTIAL|PUBLIC",
      "domainProfileRefs": "ids",
      "createdAt": "utc"
    }
  },
  "StaffMembership": {
    "schema": "IWXA_T3_STAFF_MEMBERSHIP/1",
    "fields": {
      "membershipId": "id",
      "organizationId": "id",
      "personId": "id",
      "workspaceId": "id",
      "roleId": "id",
      "grantId": "id",
      "issuerAuthorityId": "id",
      "membershipEpoch": "integer",
      "notBefore": "utc",
      "expiresAt": "utc",
      "status": "enum:PROPOSED|ACTIVE|SUSPENDED|REVOKED|EXITED",
      "statusObservedAt": "utc",
      "statusValidUntil": "utc"
    }
  },
  "AdminIssuedCredential": {
    "schema": "IWXA_T3_ADMIN_ISSUED_CREDENTIAL/1",
    "fields": {
      "credentialId": "id",
      "organizationId": "id",
      "membershipId": "id",
      "issuerAuthorityId": "id",
      "holderPersonId": "id",
      "publicKeyRef": "id",
      "custody": "enum:ORGANIZATION_VAULT|HOLDER_ORG_SCOPED",
      "personalKeySource": "false",
      "notBefore": "utc",
      "expiresAt": "utc",
      "status": "enum:ACTIVE|SUSPENDED|REVOKED"
    }
  },
  "OrganizationGrant": {
    "schema": "IWXA_T3_ORGANIZATION_GRANT_BINDING/1",
    "fields": {
      "organizationId": "id",
      "membershipId": "id",
      "grantId": "id",
      "authorityId": "id",
      "realmId": "id",
      "holderPersonId": "id",
      "roleId": "id",
      "membershipEpoch": "integer",
      "resources": "nonemptyIds",
      "actions": "nonemptyIds",
      "purposes": "nonemptyIds",
      "notBefore": "utc",
      "expiresAt": "utc",
      "signedEnvelopeDigest": "sha256"
    }
  },
  "ActiveContextSelection": {
    "schema": "IWXA_T3_ACTIVE_CONTEXT_SELECTION/1",
    "fields": {
      "selectionId": "id",
      "personId": "id",
      "contextType": "enum:PERSONAL|ORGANIZATION",
      "organizationId": "nullableId",
      "membershipId": "nullableId",
      "grantId": "nullableId",
      "workspaceId": "id",
      "selectedAt": "utc",
      "userConfirmed": "true",
      "automaticSwitch": "false"
    }
  },
  "ProductFeatureEntitlement": {
    "schema": "IWXA_T3_PRODUCT_FEATURE_ENTITLEMENT/1",
    "fields": {
      "entitlementId": "id",
      "subjectType": "enum:PERSON|ORGANIZATION",
      "subjectId": "id",
      "productId": "enum:IWXA_CONTROL_CENTER|IWXA_ADMIN_CENTER",
      "featureId": "id",
      "licenseId": "id",
      "publisherAuthorityId": "id",
      "status": "enum:ACTIVE|SUSPENDED|REVOKED|SUPERSEDED|STATUS_REQUIRED",
      "validFrom": "utc",
      "expiresAt": "utc",
      "statusValidUntil": "utc",
      "limits": "limits"
    }
  },
  "TransferIntent": {
    "schema": "IWXA_T3_TRANSFER_INTENT/1",
    "fields": {
      "transferId": "id",
      "actorPersonId": "id",
      "sourceContextType": "enum:PERSONAL|ORGANIZATION",
      "sourceOwnerId": "id",
      "recipientOrganizationId": "id",
      "packageInstanceId": "id",
      "archiveSha256": "sha256",
      "semanticRevisionId": "id",
      "selectedFieldRefs": "nonemptyIds",
      "purpose": "id",
      "userConfirmed": "true",
      "automaticSend": "false",
      "createdAt": "utc"
    }
  },
  "TransferReceipt": {
    "schema": "IWXA_T3_TRANSFER_RECEIPT/1",
    "fields": {
      "receiptId": "id",
      "transferId": "id",
      "recipientOrganizationId": "id",
      "packageInstanceId": "id",
      "archiveSha256": "sha256",
      "state": "enum:EXPORTED|RECEIVED|QUARANTINED|VERIFIED",
      "observedAt": "utc",
      "evidenceRefs": "ids",
      "corporateAccepted": "false"
    }
  },
  "AcceptanceReceipt": {
    "schema": "IWXA_T3_ACCEPTANCE_RECEIPT/1",
    "fields": {
      "acceptanceId": "id",
      "transferId": "id",
      "organizationId": "id",
      "packageInstanceId": "id",
      "archiveSha256": "sha256",
      "decision": "enum:ACCEPTED|REJECTED",
      "corporateProjectionRefs": "ids",
      "decisionActorId": "id",
      "decisionAt": "utc",
      "authorityEvidenceRef": "id",
      "transactionRevision": "integer"
    }
  }
};
export class ProductContractError extends Error { constructor(code){super(code);this.name="ProductContractError";this.code=code;} }

function reject(code){throw new ProductContractError(code);}

function isPlainObject(v){return v!==null&&typeof v==="object"&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}

function assertField(value,type,name){
 const id=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
 if(type==="id"){if(typeof value!=="string"||!id.test(value))reject("INVALID_FIELD:"+name);return;}
 if(type==="nullableId"){if(value!==null)assertField(value,"id",name);return;}
 if(type==="utc"){if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)reject("INVALID_UTC:"+name);return;}
 if(type==="integer"){if(!Number.isSafeInteger(value)||value<0)reject("INVALID_INTEGER:"+name);return;}
 if(type==="true"||type==="false"){if(value!==(type==="true"))reject("BOUNDARY_VIOLATION:"+name);return;}
 if(type==="sha256"){if(typeof value!=="string"||!/^[0-9a-f]{64}$/.test(value))reject("INVALID_DIGEST:"+name);return;}
 if(type==="ids"||type==="nonemptyIds"){if(!Array.isArray(value)||value.length>128||(type==="nonemptyIds"&&!value.length)||new Set(value).size!==value.length)reject("INVALID_IDS:"+name);for(const v of value)assertField(v,"id",name+"[]");return;}
 if(type==="limits"){if(!isPlainObject(value)||Object.keys(value).length>32)reject("INVALID_LIMITS:"+name);for(const [k,v] of Object.entries(value)){assertField(k,"id",name+".key");if(!Number.isSafeInteger(v)||v<0)reject("INVALID_LIMIT:"+name+"."+k);}return;}
 if(type.startsWith("enum:")){if(!type.slice(5).split("|").includes(value))reject("INVALID_ENUM:"+name);return;}
 reject("UNSUPPORTED_FIELD_TYPE:"+type);
}

export function validateProductContract(kind,input){
 const def=SPECS[kind];if(!def)reject("UNKNOWN_PRODUCT_CONTRACT");
 input=strictCopy(input);
 if(!isPlainObject(input))reject("PRODUCT_RECORD_REQUIRED");
 const required=["schema","kind",...Object.keys(def.fields)];
 if(Object.keys(input).length!==required.length||required.some(k=>!Object.hasOwn(input,k)))reject("PRODUCT_FIELDS_MISMATCH");
 if(input.schema!==def.schema||input.kind!==kind)reject("PRODUCT_SCHEMA_MISMATCH");
 for(const [field,type] of Object.entries(def.fields))assertField(input[field],type,field);
 const time=value=>Date.parse(value);
 if(["StaffMembership","AdminIssuedCredential","OrganizationGrant","ProductFeatureEntitlement"].includes(kind)){
  const a=input.notBefore??input.validFrom,b=input.expiresAt;
  if(!(time(a)<time(b)))reject("PRODUCT_INTERVAL_INVALID");
 }
 if(kind==="StaffMembership"&&time(input.statusObservedAt)>time(input.statusValidUntil))reject("STALE_STATUS_INTERVAL");
 if(kind==="ProductFeatureEntitlement"){
  if(time(input.statusValidUntil)>time(input.expiresAt))reject("LICENSE_STATUS_OUTSIDE_LICENSE");
  if((input.productId==="IWXA_ADMIN_CENTER")!==(input.subjectType==="ORGANIZATION"))reject("ENTITLEMENT_SUBJECT_PRODUCT_MISMATCH");
 }
 if(kind==="TransferIntent"&&input.sourceContextType==="ORGANIZATION"&&input.sourceOwnerId===input.actorPersonId)reject("ORG_SOURCE_OWNER_INVALID");
 if(kind==="AcceptanceReceipt"){
  if(input.decision==="REJECTED"&&input.corporateProjectionRefs.length!==0)reject("REJECTED_PROJECTION_FORBIDDEN");
  if(input.decision==="ACCEPTED"&&input.corporateProjectionRefs.length===0)reject("ACCEPTED_PROJECTION_REQUIRED");
 }
 return JSON.parse(JSON.stringify(input));
}

export function selectContextCandidate(profile,selection,context,at){
 const person=validateProductContract("PersonalSubjectProfile",profile);
 const choice=validateProductContract("ActiveContextSelection",selection);
 assertField(at,"utc","at");
 if(person.personId!==choice.personId||Date.parse(choice.selectedAt)>Date.parse(at))reject("PERSON_SELECTION_MISMATCH");
 context=strictCopy(context);
 const orgs=context?.organizations,spaces=context?.workspaces,members=context?.memberships,grants=context?.grants;
 if(!Array.isArray(orgs)||!Array.isArray(spaces)||!Array.isArray(members)||!Array.isArray(grants))reject("CONTEXT_SOURCES_REQUIRED");
 const organizations=orgs.map(x=>validateProductContract("OrganizationIdentity",x));
 const workspaces=spaces.map(x=>validateProductContract("ManagedWorkspace",x));
 const memberships=members.map(x=>validateProductContract("StaffMembership",x));
 const grantBindings=grants.map(x=>validateProductContract("OrganizationGrant",x));
 for(const [rows,key] of [[organizations,"organizationId"],[workspaces,"workspaceId"],[memberships,"membershipId"],[grantBindings,"grantId"]])if(new Set(rows.map(x=>x[key])).size!==rows.length)reject("DUPLICATE_CONTEXT_ID:"+key);
 const seenRoots=new Map([[person.personalDataRootId,"PERSON"]]);
 for(const org of organizations){if(seenRoots.has(org.organizationDataRootId))reject("CROSS_SUBJECT_ROOT_COLLISION");seenRoots.set(org.organizationDataRootId,org.organizationId);}
 if(choice.contextType==="PERSONAL"){
  if(choice.organizationId!==null||choice.membershipId!==null||choice.grantId!==null||choice.workspaceId!==person.personalDataRootId)reject("PERSONAL_SCOPE_INVALID");
  return {schema:"IWXA_T3_CONTEXT_CANDIDATE/1",outcome:"PREVIEW_ONLY",subjectType:"PERSON",subjectId:person.personId,dataRootId:person.personalDataRootId,requiredAuthority:"PERSON_LOCAL",authorized:false};
 }
 const org=organizations.find(x=>x.organizationId===choice.organizationId);
 const workspace=workspaces.find(x=>x.workspaceId===choice.workspaceId);
 const member=memberships.find(x=>x.membershipId===choice.membershipId);
 const grant=grantBindings.find(x=>x.grantId===choice.grantId);
 if(!org||!workspace||!member||!grant)reject("ORG_CONTEXT_BINDING_MISSING");
 if(org.organizationId!==workspace.organizationId||org.organizationId!==member.organizationId||org.organizationId!==grant.organizationId)reject("CROSS_ORGANIZATION_SCOPE");
 if(workspace.ownerDataRootId!==org.organizationDataRootId||member.workspaceId!==workspace.workspaceId)reject("ORG_WORKSPACE_ROOT_MISMATCH");
 if(member.personId!==person.personId||grant.holderPersonId!==person.personId||member.grantId!==grant.grantId||member.membershipId!==grant.membershipId)reject("ORG_MEMBER_GRANT_MISMATCH");
 if(member.issuerAuthorityId!==org.issuerAuthorityId||grant.authorityId!==org.issuerAuthorityId||grant.realmId!==org.realmId||member.roleId!==grant.roleId)reject("ORG_AUTHORITY_MISMATCH");
 if(member.membershipEpoch!==org.membershipEpoch||grant.membershipEpoch!==org.membershipEpoch)reject("ORG_EPOCH_STALE");
 if(member.status!=="ACTIVE")reject("ORG_MEMBER_NOT_ACTIVE");
 const now=Date.parse(at);
 if(!(Date.parse(member.notBefore)<=now&&now<Date.parse(member.expiresAt)&&Date.parse(grant.notBefore)<=now&&now<Date.parse(grant.expiresAt)))reject("ORG_MEMBERSHIP_OR_GRANT_EXPIRED");
 if(!(Date.parse(member.statusObservedAt)<=now&&now<Date.parse(member.statusValidUntil)))reject("OFFLINE_STATUS_STALE");
 // Evidence references and status times here are NOT signature/status verification.
 return {schema:"IWXA_T3_CONTEXT_CANDIDATE/1",outcome:"PREVIEW_ONLY",subjectType:"ORGANIZATION",subjectId:org.organizationId,dataRootId:org.organizationDataRootId,requiredAuthority:"EXISTING_T3_ACCESS_EVALUATOR_JIT",grantId:grant.grantId,authorized:false};
}

export function capabilityPreview(catalog,productId,featureId){
 catalog=strictCopy(catalog);
 if(!isPlainObject(catalog)||catalog.schema!=="IWXA_T3_PRODUCT_CAPABILITY_MAPPING/1"||!Array.isArray(catalog.features))reject("CAPABILITY_CATALOG_INVALID");
 assertField(productId,"id","productId");assertField(featureId,"id","featureId");
 const feature=catalog.features.find(f=>f.productId===productId&&f.featureId===featureId);
 if(!feature)reject("FEATURE_NOT_DECLARED");
 if(feature.commercialPolicy!=="UNDECIDED"||!["PERSON_LOCAL","ORGANIZATIONAL_GRANT","PUBLISHER_ONLY"].includes(feature.authorityGate))reject("CAPABILITY_POLICY_INVALID");
 return {schema:"IWXA_T3_CAPABILITY_PREVIEW/1",productId,featureId,authorityGate:feature.authorityGate,commercialPolicy:"UNDECIDED",entitlementIsAuthority:false,authorized:false,productionEnabled:false};
}
export const PRODUCT_CONTRACT_IDS=Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([k,v])=>[k,v.schema])));
