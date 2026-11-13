// Original IWXA T3 local cryptographic Ed25519 key vault adopted as ONE executable implementation in knowledge.
// No independent Kernel/Store/Access issuer, no committed real keys.
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { strictJson } from './strict-json.mjs';

const b64=b=>Buffer.from(b).toString('base64url');
const unb64=(s,length=null)=>{insist(typeof s==='string'&&s.length>0&&s.length<=4*1024*1024&&/^[A-Za-z0-9_-]+$/.test(s),'VAULT_ENCODING_INVALID');const b=Buffer.from(s,'base64url');insist(b.toString('base64url')===s&&(length===null||b.length===length),'VAULT_ENCODING_INVALID');return b;};
function insist(ok,code){if(!ok){const e=new Error(code);e.code=code;throw e;}}
function derive(passphrase,salt){insist(typeof passphrase==='string'&&passphrase.length>=12,'VAULT_PASSPHRASE_TOO_SHORT');return scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
function publicPem(privatePem){const pk=createPrivateKey(privatePem);insist(pk.asymmetricKeyType==='ed25519','ED25519_PRIVATE_KEY_REQUIRED');return createPublicKey(pk).export({type:'spki',format:'pem'}).toString();}
export function validateVault(vault){
  insist(vault?.schema==='IWXA_T3_LOCAL_KEY_VAULT_CONTENT/1'&&vault.version===1&&vault.keys&&typeof vault.keys==='object'&&!Array.isArray(vault.keys)&&Object.keys(vault.keys).length<=128,'VAULT_CONTENT_INVALID');
  for(const [id,k] of Object.entries(vault.keys)){
    insist(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id)&&k?.keyId===id&&typeof k.subjectId==='string'&&k.subjectId.length>0&&k.algorithm==='Ed25519'&&Number.isFinite(Date.parse(k.createdAt))&&typeof k.privateKeyPem==='string'&&k.privateKeyPem.length<4096,'VAULT_KEY_INVALID');
    try{insist(publicPem(k.privateKeyPem)===k.publicKeyPem,'VAULT_PUBLIC_PRIVATE_MISMATCH');}catch{throw new Error('VAULT_KEY_INVALID');}
  }
  return vault;
}
export function emptyVault(){return {schema:'IWXA_T3_LOCAL_KEY_VAULT_CONTENT/1',version:1,keys:{}};}
export function generateVaultKey(vault,{keyId,subjectId,createdAt=new Date().toISOString()}={}){
  insist(typeof keyId==='string'&&keyId,'KEY_ID_REQUIRED');insist(typeof subjectId==='string'&&subjectId,'SUBJECT_ID_REQUIRED');insist(!vault.keys[keyId],'KEY_ALREADY_EXISTS');
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  vault.keys[keyId]={keyId,subjectId,algorithm:'Ed25519',createdAt,privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString()};
  return vault.keys[keyId];
}
export function importVaultKey(vault,{keyId,subjectId,privateKeyPem,expectedPublicKeyPem=null,createdAt=new Date().toISOString()}={}){
  insist(typeof keyId==='string'&&keyId,'KEY_ID_REQUIRED');insist(typeof subjectId==='string'&&subjectId,'SUBJECT_ID_REQUIRED');insist(!vault.keys[keyId],'KEY_ALREADY_EXISTS');
  const pub=publicPem(privateKeyPem); if(expectedPublicKeyPem){const a=Buffer.from(pub),b=Buffer.from(String(expectedPublicKeyPem));insist(a.length===b.length&&timingSafeEqual(a,b),'PUBLIC_KEY_MISMATCH');}
  vault.keys[keyId]={keyId,subjectId,algorithm:'Ed25519',createdAt,privateKeyPem:String(privateKeyPem),publicKeyPem:pub}; return vault.keys[keyId];
}
export function encryptVault(vault,passphrase){
  validateVault(vault);
  const salt=randomBytes(16),iv=randomBytes(12),key=derive(passphrase,salt),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('IWXA-T3-LOCAL-KEY-VAULT-V1'));
  const plain=Buffer.from(JSON.stringify(vault),'utf8'),ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();key.fill(0);plain.fill(0);
  return {schema:'IWXA_T3_LOCAL_KEY_VAULT/1',kdf:{name:'scrypt',N:32768,r:8,p:1,salt:b64(salt)},cipher:{name:'AES-256-GCM',iv:b64(iv),tag:b64(tag),aad:'IWXA-T3-LOCAL-KEY-VAULT-V1'},ciphertext:b64(ciphertext)};
}
export function decryptVault(record,passphrase){
  insist(record?.schema==='IWXA_T3_LOCAL_KEY_VAULT/1','VAULT_SCHEMA_INVALID');insist(record.kdf?.name==='scrypt'&&record.kdf.N===32768&&record.kdf.r===8&&record.kdf.p===1,'VAULT_KDF_INVALID');insist(record.cipher?.name==='AES-256-GCM'&&record.cipher.aad==='IWXA-T3-LOCAL-KEY-VAULT-V1','VAULT_CIPHER_INVALID');
  const salt=unb64(record.kdf.salt,16),iv=unb64(record.cipher.iv,12),tag=unb64(record.cipher.tag,16),ciphertext=unb64(record.ciphertext),key=derive(passphrase,salt);
  let plain;try{const dec=createDecipheriv('aes-256-gcm',key,iv);dec.setAAD(Buffer.from(record.cipher.aad));dec.setAuthTag(tag);plain=Buffer.concat([dec.update(ciphertext),dec.final()]);}catch{throw Object.assign(new Error('VAULT_UNLOCK_FAILED'),{code:'VAULT_UNLOCK_FAILED'});}finally{key.fill(0);}
  let vault;try{vault=strictJson(plain.toString('utf8'));}catch{throw new Error('VAULT_CONTENT_INVALID');}finally{plain.fill(0);}return validateVault(vault);
}
export function vaultPublicInventory(vault){return Object.fromEntries(Object.entries(vault.keys).map(([id,k])=>[id,{keyId:id,subjectId:k.subjectId,algorithm:k.algorithm,createdAt:k.createdAt,publicKeyPem:k.publicKeyPem}]));}
export function vaultPrivateKey(vault,keyId){const k=vault.keys[keyId];insist(k,'VAULT_KEY_NOT_FOUND');return createPrivateKey(k.privateKeyPem);}
