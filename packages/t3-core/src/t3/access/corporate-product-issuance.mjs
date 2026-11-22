// One Core extension of the ORIGINAL T3 product issuance ledger.
// This writes only to ownerState.productLicenseIssueLedger and requires the
// installed original Owner's transactional compare-and-commit callback.
// It does NOT create a Store, journal, issuer, signer, IAM or .iwxa carrier.
import {copy,digest,identifier,insist,iso,timestamp} from './core.mjs';
import {validateCorporateLicenseRequest,validateCorporateLicensePayload,
  createCorporateLicenseCandidate,signCorporateLicenseCandidate,
  inspectSignedCorporateLicense,CORPORATE_LICENSE_SCHEMA
} from './corporate-product-license.mjs';

export const ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA='IWXA_T3_PRODUCT_LICENSE_ISSUE_LEDGER/1';
const HEX=/^[a-f0-9]{64}$/;

function inspectOriginalLedger(input,ownerState,inspectLegacyLedger){
  const ledger=copy(input??{schema:ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA,
    revision:0,records:{}});
  insist(ledger.schema===ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA&&
    Object.keys(ledger).length===3&&
    Number.isSafeInteger(ledger.revision)&&ledger.revision>=0&&
    ledger.records&&typeof ledger.records==='object'&&
    !Array.isArray(ledger.records)&&
    Object.keys(ledger.records).length<=4096,
    'CORP_ORIGINAL_ISSUE_LEDGER_REQUIRED');
  const other={};
  for(const [id,row] of Object.entries(ledger.records)){
    identifier(id);
    insist(row&&typeof row==='object'&&!Array.isArray(row)&&
      Object.keys(row).length===3&&
      Object.hasOwn(row,'issuerAuthorityId')&&
      Object.hasOwn(row,'requestDigest')&&
      Object.hasOwn(row,'signedLicense')&&
      HEX.test(row.requestDigest),
      'CORP_ORIGINAL_ISSUE_ROW_INVALID');
    identifier(row.issuerAuthorityId);
    if(row.signedLicense?.payload?.schema!==CORPORATE_LICENSE_SCHEMA){
      other[id]=row;
      continue;
    }
    const p=validateCorporateLicensePayload(row.signedLicense.payload);
    insist(p.requestId===id&&p.issuerAuthorityId===row.issuerAuthorityId,
      'CORP_ORIGINAL_LEDGER_BINDING_INVALID');
    // Historical signatures are verified at issue, not at today's clock.
    // A recovered old transaction cannot create new rights after expiration.
    inspectSignedCorporateLicense({envelope:row.signedLicense,
      installedTrust:ownerState,organizationId:p.subject.id,
      now:timestamp(p.notBefore)});
  }
  if(Object.keys(other).length){
    insist(typeof inspectLegacyLedger==='function',
      'CORP_ORIGINAL_LEGACY_LEDGER_INSPECTOR_REQUIRED');
    const verified=inspectLegacyLedger({schema:ledger.schema,
      revision:ledger.revision,records:copy(other)});
    insist(verified?.schema===ledger.schema&&
      verified.revision===ledger.revision&&
      digest(verified.records)===digest(other),
      'CORP_ORIGINAL_LEGACY_LEDGER_NOT_VERIFIED');
  }
  return ledger;
}

/** Existing original issuance ledger + original Host CAS only.
 *
 * The caller must supply its already-enrolled private signing handle and its
 * existing atomic Owner Store compare-and-commit. Issue records are not local
 * UI preparation, and a successful receipt does not admit a receiving agent.
 */
export function issueCorporateProductLicenseOnce({
  request,ownerState,issuerAuthorityId,signer,licenseId,lineageId,
  renewalOf=null,persist,inspectLegacyLedger,now=Date.now()
}={}){
  const r=validateCorporateLicenseRequest(request);
  identifier(issuerAuthorityId);
  insist(ownerState?.policy?.environment==='PRODUCTION'&&
    Number.isSafeInteger(ownerState.revision)&&ownerState.revision>=0&&
    Number.isSafeInteger(ownerState.revision+1)&&
    Number.isSafeInteger(now)&&now>=timestamp(r.requestedAt)&&
    now>=timestamp(ownerState.lastObservedAt??iso(0)),
    'CORP_ORIGINAL_ISSUE_STATE_OR_TIME_INVALID');
  const ledger=inspectOriginalLedger(ownerState.productLicenseIssueLedger,
    ownerState,inspectLegacyLedger);
  const requestDigest=digest(r);
  const previous=ledger.records[r.requestId];
  if(previous){
    insist(previous.issuerAuthorityId===issuerAuthorityId,
      'CORP_ORIGINAL_ISSUE_AUTHORITY_CONFLICT');
    insist(previous.requestDigest===requestDigest,
      'CORP_ORIGINAL_ISSUE_REQUEST_CONFLICT');
    insist(previous.signedLicense?.payload?.schema===CORPORATE_LICENSE_SCHEMA,
      'CORP_ORIGINAL_ISSUE_PROFILE_CONFLICT');
    const p=previous.signedLicense.payload;
    insist(p.subject.id===r.subject.id&&
      digest(p.product)===digest(r.product)&&
      digest(p.tariff)===digest(r.tariff)&&
      digest(p.featureIds)===digest(r.featureIds)&&
      digest(p.limits)===digest(r.limits)&&
      timestamp(p.expiresAt)-timestamp(p.notBefore)===r.termDays*86400000,
      'CORP_ORIGINAL_ISSUE_SOURCE_MISMATCH');
    inspectSignedCorporateLicense({envelope:previous.signedLicense,
      installedTrust:ownerState,organizationId:r.subject.id,
      now:timestamp(p.notBefore)});
    return Object.freeze({outcome:'ALREADY_ISSUED',
      signedLicense:copy(previous.signedLicense),
      changed:false,ledgerRevision:ledger.revision,
      activeSeats:0,assignablePersonalAgentSeats:0,
      recipientConfirmed:false});
  }
  insist(Object.keys(ledger.records).length<4096,
    'CORP_ORIGINAL_ISSUE_LEDGER_FULL');
  insist(typeof persist==='function','CORP_ORIGINAL_ATOMIC_PERSIST_REQUIRED');
  const payload=createCorporateLicenseCandidate({request:r,ownerState,
    issuerAuthorityId,licenseId,lineageId,renewalOf,now});
  insist(!Object.values(ledger.records).some(e=>e.signedLicense?.payload?.id===payload.id),
    'CORP_ORIGINAL_LICENSE_ID_CONFLICT');
  const signedLicense=signCorporateLicenseCandidate({payload,
    ownerState,signer,now});
  const next=copy(ownerState);
  next.revision++;
  next.lastObservedAt=iso(now);
  next.productLicenseIssueLedger={
    schema:ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA,
    revision:ledger.revision+1,
    records:{...ledger.records,[r.requestId]:{
      requestDigest,issuerAuthorityId,signedLicense:copy(signedLicense)
    }}
  };
  const receipt=persist(copy(next),{
    expectedStateRevision:ownerState.revision,
    expectedLedgerRevision:ledger.revision
  });
  insist(receipt?.durable===true&&
    receipt.stateRevision===next.revision&&
    receipt.ledgerRevision===ledger.revision+1,
    'CORP_ORIGINAL_DURABLE_ISSUE_RECEIPT_REQUIRED');
  return Object.freeze({outcome:'ISSUED_NEW',changed:true,
    signedLicense:copy(signedLicense),ledgerRevision:ledger.revision+1,
    activeSeats:0,assignablePersonalAgentSeats:0,
    recipientConfirmed:false});
}
