import {createWebDavPackageTransport} from './webdav-package-transfer.mjs';

export class T4OperatorConnectionError extends Error {
  constructor(code) {super(code);this.name='T4OperatorConnectionError';this.code=code;}
}
const fail=code=>{throw new T4OperatorConnectionError(code);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const classes=v=>Array.isArray(v)&&v.length>0&&v.length<=64&&
  v.every(id)&&new Set(v).size===v.length;
const MODES=new Set(['SELF_HOSTED','THIRD_PARTY','IWXA_CLOUD']);
const FORBIDDEN_PROFILE_KEYS=['password','token','authorization','secret','apiKey','accessKey'];

export function createT4NetworkConnectionProfile(input={}) {
  if (!MODES.has(input.mode)) fail('INVALID_NETWORK_PROFILE');
  if (!id(input.profileRef)||!id(input.operatorRef)||!id(input.locationRef)) {
    fail('NETWORK_PROFILE_FIELDS_REQUIRED');
  }
  if (FORBIDDEN_PROFILE_KEYS.some(key=>Object.hasOwn(input,key))) fail('CREDENTIAL_IN_PROFILE');
  const cloud=input.mode==='IWXA_CLOUD', agreement=input.cloudAgreement;
  if (cloud) {
    if (input.operatorRef!=='iwxa:operator' || !agreement ||
      agreement.schema!=='IWXA_T4_CLOUD_PARTICIPATION_AGREEMENT_V1' ||
      !id(agreement.originalOwnerRef) || !id(agreement.authorityEvidenceRef) ||
      !digest(agreement.termsDigest) ||
      !classes(agreement.permittedDataFamilies) ||
      !classes(agreement.permittedPurposes) ||
      agreement.operatorMayUseVerifiedAnonymizedDerivatives!==true ||
      agreement.rawSourceDataOwnershipTransferred!==false ||
      agreement.rawSourceDataMayBeRedistributed!==false ||
      agreement.reidentificationPermitted!==false) {
      fail('IWXA_CLOUD_AGREEMENT_REQUIRED');
    }
  } else if (agreement!==null && agreement!==undefined) {
    fail('IWXA_CLOUD_AGREEMENT_NOT_APPLICABLE');
  }
  const normalizedAgreement=!cloud?null:Object.freeze({
    schema:agreement.schema,originalOwnerRef:agreement.originalOwnerRef,
    authorityEvidenceRef:agreement.authorityEvidenceRef,termsDigest:agreement.termsDigest,
    permittedDataFamilies:Object.freeze([...agreement.permittedDataFamilies]),
    permittedPurposes:Object.freeze([...agreement.permittedPurposes]),
    operatorMayUseVerifiedAnonymizedDerivatives:true,
    rawSourceDataOwnershipTransferred:false,
    rawSourceDataMayBeRedistributed:false,
    reidentificationPermitted:false,
  });
  return Object.freeze({
    schema:'IWXA_T4_NETWORK_CONNECTION_PROFILE_V1',
    profileRef:input.profileRef,mode:input.mode,operatorRef:input.operatorRef,
    locationRef:input.locationRef,endpointUrl:input.endpointUrl,
    cloudAgreement:normalizedAgreement,cloudAgreementVerified:false,
    iwxaDerivedDataRightByDefault:false,
  });
}

export function openT4OperatorConnection({
  profile,placementPolicy,getMode,authorize,getAuthorizationHeader,
  verifyOriginalOwnerAgreement,verifyOperatorEndpoint,fetchImpl,maxBytes,timeoutMs,allowHttpLoopbackFixture,
  nativeWireProfile=null,
}={}) {
  if (profile?.schema!=='IWXA_T4_NETWORK_CONNECTION_PROFILE_V1' ||
    typeof authorize!=='function' || typeof getMode!=='function' ||
    typeof getAuthorizationHeader!=='function') fail('NETWORK_PORTS_REQUIRED');
  if(nativeWireProfile!==null&&!['LEGACY','INDEXED'].includes(nativeWireProfile))fail('NETWORK_NATIVE_PROFILE_INVALID');
  const native=nativeWireProfile!==null,cloud=profile.mode==='IWXA_CLOUD';
  if(cloud&&typeof verifyOriginalOwnerAgreement!=='function') fail('ORIGINAL_OWNER_AGREEMENT_PORT_REQUIRED');
  if(cloud&&typeof verifyOperatorEndpoint!=='function') fail('IWXA_OPERATOR_ENDPOINT_VERIFIER_REQUIRED');
  if(native&&typeof verifyOperatorEndpoint!=='function') fail('ORIGINAL_NATIVE_ENDPOINT_VERIFIER_REQUIRED');
  const routed=ctx=>Object.freeze({...ctx,operatorRef:profile.operatorRef,profileRef:profile.profileRef,profileMode:profile.mode});
  const checkedAuthorize=async ctx=>{
    if(nativeWireProfile==='INDEXED'&&ctx.operation==='t4.network.frame.discover')return false;
    if(await authorize(routed(ctx))!==true) return false;
    if(!cloud&&!native) return true;
    if(await verifyOperatorEndpoint(Object.freeze({
      profileRef:profile.profileRef,operatorRef:profile.operatorRef,
      locationRef:profile.locationRef,endpointUrl:profile.endpointUrl,
      workspaceId:ctx.workspaceId,operation:ctx.operation,
    }))!==true) return false;
    if(!cloud)return true;
    return await verifyOriginalOwnerAgreement(Object.freeze({
      operation:ctx.operation,profileRef:profile.profileRef,
      workspaceId:ctx.workspaceId,originalOwnerRef:profile.cloudAgreement.originalOwnerRef,
      authorityEvidenceRef:profile.cloudAgreement.authorityEvidenceRef,
      termsDigest:profile.cloudAgreement.termsDigest,
      permittedDataFamilies:profile.cloudAgreement.permittedDataFamilies,
      permittedPurposes:profile.cloudAgreement.permittedPurposes,
    }))===true;
  };
  const transport=createWebDavPackageTransport({
    baseUrl:profile.endpointUrl,locationRef:profile.locationRef,placementPolicy,
    getMode,authorize:checkedAuthorize,getAuthorizationHeader:ctx=>getAuthorizationHeader(routed(ctx)),fetchImpl,maxBytes,
    timeoutMs,allowHttpLoopbackFixture,
    ...(native?{keySuffix:'.t4n',candidateNetworkWire:true,indexedNetworkWire:nativeWireProfile==='INDEXED'}:{}),
  });
  return Object.freeze({
    profile,transport,close:()=>transport.close(),
    ...(native?{nativeWireProfile}:{}),
    operatorAgreementDeclared:cloud,
    operatorAgreementCheckedPerNetworkRequest:cloud,
    operatorMayUseVerifiedAnonymizedDerivatives:false,
    automaticDataExtractionEnabled:false,
    originalDataOwnershipTransferred:false,
  });
}
