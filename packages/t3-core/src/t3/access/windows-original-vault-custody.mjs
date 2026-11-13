// Windows OS custody for the ONE existing encrypted IWXA T3 Ed25519 vault.
// This is a trusted Node Host-only adapter, not a second key store, IAM,
// issuer, or browser API. The original signer continues to decrypt/sign using
// local-vault.mjs and original-vault-proof.mjs without protocol changes.
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lstat,open,readFile,link,unlink,rename} from "node:fs/promises";
import {basename,dirname,isAbsolute,join} from "node:path";
import {encryptVault,decryptVault,importVaultKey,vaultPublicInventory,validateVault} from "./local-vault.mjs";
import {strictJson} from "./strict-json.mjs";

const CUSTODY_SCHEMA="IWXA_T3_WINDOWS_DPAPI_CUSTODY/1";
const VAULT_SCHEMA="IWXA_T3_LOCAL_KEY_VAULT/1";
const ENTROPY="IWXA-T3-WINDOWS-KEY-VAULT/1";
const MAX_RECORD_BYTES=1024*1024;
const MAX_DPAPI_BYTES=8192;
// A cold Windows PowerShell/.NET ProtectedData startup can exceed 15s
// under concurrent Rust/native CI load. Keep an explicit finite timeout,
// never fall back to an unprotected credential or a different key store.
const DPAPI_TIMEOUT_MS=45000;

function deny(code){
  const e=new Error(code);e.name="T3WindowsVaultCustodyError";
  e.code=code;e.outcome="DENIED";throw e;
}
function required(ok,code){if(!ok)deny(code);}
function decodeBase64Url(value){
  required(typeof value==="string"&&value.length>0&&
    value.length<=MAX_DPAPI_BYTES*2&&/^[A-Za-z0-9_-]+$/.test(value),
    "T3_WINDOWS_DPAPI_RECORD_INVALID");
  const bytes=Buffer.from(value,"base64url");
  required(bytes.length>0&&bytes.length<=MAX_DPAPI_BYTES&&
    bytes.toString("base64url")===value,
    "T3_WINDOWS_DPAPI_RECORD_INVALID");
  return bytes;
}
function sealedRecord(record){
  required(record?.schema===VAULT_SCHEMA&&
    record.osCustody?.schema===CUSTODY_SCHEMA&&
    record.osCustody?.scope==="CURRENT_USER"&&
    typeof record.osCustody.protectedSecret==="string",
    "T3_WINDOWS_DPAPI_RECORD_INVALID");
  decodeBase64Url(record.osCustody.protectedSecret);
  return record;
}

// Call the OS ProtectedData API via the Windows-owned PowerShell executable.
// The script is constant; all confidential bytes travel over stdin and never
// in command-line arguments, JavaScript URLs, environment variables or logs.
// CurrentUser binds the protected key to the Windows logon identity.
async function windowsProtectedData(mode,bytes){
  required(process.platform==="win32","T3_WINDOWS_DPAPI_REQUIRED");
  required((mode==="protect"||mode==="unprotect")&&
    Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_DPAPI_BYTES,
    "T3_WINDOWS_DPAPI_INPUT_INVALID");
  const script=[
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    '$entropy = [Text.Encoding]::UTF8.GetBytes("'+ENTROPY+'")',
    '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
    mode==="protect"
      ?'$result = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropy, $scope)'
      :'$result = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropy, $scope)',
    '[Console]::Out.Write([Convert]::ToBase64String($result))',
  ].join("; ");
  const executable=join(process.env.SystemRoot||"C:\\Windows",
    "System32","WindowsPowerShell","v1.0","powershell.exe");
  const args=["-NoLogo","-NoProfile","-NonInteractive",
    "-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")];
  const code=mode==="protect"
    ?"T3_WINDOWS_DPAPI_PROTECT_FAILED":"T3_WINDOWS_DPAPI_UNSEAL_FAILED";
  return await new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(executable,args,{windowsHide:true,
        stdio:["pipe","pipe","ignore"]});
    }catch{return reject(Object.assign(new Error(code),{code}));}
    let stdout="",overflow=false,settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error)reject(Object.assign(new Error(code),{code}));
      else resolve(value);
    };
    const timer=setTimeout(()=>{
      child.kill();finish(true);
    },DPAPI_TIMEOUT_MS);
    child.on("error",()=>finish(true));
    child.stdout.on("data",part=>{
      stdout+=part.toString("ascii");
      if(stdout.length>MAX_DPAPI_BYTES*2){
        overflow=true;child.kill();
      }
    });
    child.on("close",exitCode=>{
      if(exitCode!==0||overflow)return finish(true);
      const result=stdout.trim();
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(result))
        return finish(true);
      const decoded=Buffer.from(result,"base64");
      if(decoded.length===0||decoded.length>MAX_DPAPI_BYTES||
        decoded.toString("base64")!==result)return finish(true);
      finish(false,decoded);
    });
    const input=Buffer.from(bytes.toString("base64"),"ascii");
    child.stdin.on("error",()=>finish(true));
    child.stdin.end(input);
  });
}

/**
 * Install the original vault with a randomly generated unlock secret sealed
 * by Windows DPAPI CurrentUser in the SAME atomic encrypted-vault JSON file.
 * No auto-provisioning and no overwrite: the trusted issuer/Host must supply
 * the enrolled keys explicitly. This module never grants an operation.
 *
 * Pass readEncryptedVault and unlockPassphrase unchanged to
 * createOriginalVaultProofSigner({keyId,organizationId,...}).
 */
export function createWindowsOriginalVaultCustody({vaultPath}={}){
  required(process.platform==="win32","T3_WINDOWS_DPAPI_REQUIRED");
  required(typeof vaultPath==="string"&&vaultPath.length>0&&
    isAbsolute(vaultPath)&&!vaultPath.startsWith("\\\\"),
    "T3_WINDOWS_DPAPI_PATH_INVALID");
  const readEnvelope=async()=>{
    let raw;
    try{
      const stat=await lstat(vaultPath);
      required(stat.isFile()&&stat.size>0&&
        stat.size<=MAX_RECORD_BYTES,"T3_WINDOWS_DPAPI_RECORD_INVALID");
      raw=await readFile(vaultPath,"utf8");
    }catch(error){
      if(error?.code?.startsWith("T3_WINDOWS_"))throw error;
      deny("T3_WINDOWS_DPAPI_VAULT_UNAVAILABLE");
    }
    required(Buffer.byteLength(raw,"utf8")<=MAX_RECORD_BYTES,
      "T3_WINDOWS_DPAPI_RECORD_INVALID");
    let record;
    try{record=strictJson(raw);}
    catch{deny("T3_WINDOWS_DPAPI_RECORD_INVALID");}
    return sealedRecord(record);
  };
  const unsealPassphrase=async record=>{
      const protectedSecret=decodeBase64Url(
        record.osCustody.protectedSecret);
      let secretBytes;
      try{
        secretBytes=await windowsProtectedData("unprotect",protectedSecret);
        const passphrase=secretBytes.toString("utf8");
        required(passphrase.length>=12&&passphrase.length<=256&&
          /^[A-Za-z0-9_-]+$/.test(passphrase),
          "T3_WINDOWS_DPAPI_UNSEAL_FAILED");
        return passphrase;
      }finally{
        protectedSecret.fill(0);
        secretBytes?.fill(0);
      }
  };
  return Object.freeze({
    readEncryptedVault:readEnvelope,
    unlockPassphrase:async()=>unsealPassphrase(await readEnvelope()),
    // Enrolled public keys can be listed by the trusted native Host, but
    // public-key possession is never treated as a signed corporate grant.
    inventory:async()=>{
      const record=await readEnvelope();
      const phrase=await unsealPassphrase(record);
      return vaultPublicInventory(decryptVault(record,phrase));
    },
    // A trusted Control imports ONE externally issued Ed25519 credential at
    // a time. The caller must already have checked its real signed issuer,
    // enrollment and public key through the original Access owner. This API
    // only preserves OS custody; it never issues an organization grant.
    enrollCredential:async ({keyId,subjectId,privateKeyPem,
      expectedPublicKeyPem,createdAt}={})=>{
      required(typeof expectedPublicKeyPem==="string"&&
        expectedPublicKeyPem.includes("BEGIN PUBLIC KEY"),
        "T3_WINDOWS_DPAPI_EXPECTED_PUBLIC_KEY_REQUIRED");
      const lockPath=vaultPath+".enrollment.lock";
      let lockHandle=null,tempPath=null;
      try{
        // Exclusive CREATE is a cross-process Windows ownership gate.
        // A second Control process must fail rather than silently discard
        // credentials written by the first. Crash recovery is explicit.
        try{lockHandle=await open(lockPath,"wx",0o600);}
        catch(error){
          if(error?.code==="EEXIST")deny("T3_WINDOWS_DPAPI_ENROLLMENT_BUSY");
          deny("T3_WINDOWS_DPAPI_LOCK_UNAVAILABLE");
        }
        const record=await readEnvelope();
        const phrase=await unsealPassphrase(record);
        const vault=decryptVault(record,phrase);
        const imported=importVaultKey(vault,{keyId,subjectId,
          privateKeyPem,expectedPublicKeyPem,createdAt});
        validateVault(vault);
        // Preserve the original DPAPI CurrentUser binding. Only the
        // authenticated original vault ciphertext changes with a fresh IV.
        const updated={...encryptVault(vault,phrase),osCustody:record.osCustody};
        const bytes=JSON.stringify(updated);
        required(Buffer.byteLength(bytes,"utf8")<=MAX_RECORD_BYTES,
          "T3_WINDOWS_DPAPI_RECORD_INVALID");
        tempPath=join(dirname(vaultPath),
          "."+basename(vaultPath)+"."+process.pid+"."+
          randomBytes(12).toString("hex")+".enrolling");
        const handle=await open(tempPath,"wx",0o600);
        try{await handle.writeFile(bytes,"utf8");await handle.sync();}
        finally{await handle.close();}
        // This replaces the ONE original vault on the same volume. No
        // plaintext staging, additional credential Store, or sidecar IAM.
        await rename(tempPath,vaultPath);
        tempPath=null;
        return Object.freeze({keyId:imported.keyId,
          subjectId:imported.subjectId,algorithm:imported.algorithm,
          publicKeyPem:imported.publicKeyPem});
      }finally{
        if(tempPath)await unlink(tempPath).catch(()=>{});
        if(lockHandle){
          await lockHandle.close().catch(()=>{});
          await unlink(lockPath).catch(()=>{});
        }
      }
    },
    provision:async vault=>{
      validateVault(vault);
      const secret=randomBytes(48).toString("base64url");
      const encrypted=encryptVault(vault,secret);
      const protectedSecret=await windowsProtectedData(
        "protect",Buffer.from(secret,"utf8"));
      const record={...encrypted,osCustody:{
        schema:CUSTODY_SCHEMA,scope:"CURRENT_USER",
        protectedSecret:protectedSecret.toString("base64url"),
      }};
      protectedSecret.fill(0);
      const contents=JSON.stringify(record);
      required(Buffer.byteLength(contents,"utf8")<=MAX_RECORD_BYTES,
        "T3_WINDOWS_DPAPI_RECORD_INVALID");
      const temp=join(dirname(vaultPath),
        "."+basename(vaultPath)+"."+process.pid+"."+
        randomBytes(12).toString("hex")+".tmp");
      let handle;
      try{
        handle=await open(temp,"wx",0o600);
        await handle.writeFile(contents,"utf8");
        await handle.sync();
        await handle.close();handle=null;
        // Hard-link publication is an atomic CREATE-IF-ABSENT on NTFS.
        // Never replace an already issued key vault during installation.
        await link(temp,vaultPath);
      }catch(error){
        if(error?.code==="EEXIST")deny("T3_WINDOWS_DPAPI_VAULT_EXISTS");
        deny("T3_WINDOWS_DPAPI_WRITE_FAILED");
      }finally{
        await handle?.close().catch(()=>{});
        await unlink(temp).catch(()=>{});
      }
      return {schema:CUSTODY_SCHEMA,scope:"CURRENT_USER"};
    },
  });
}
