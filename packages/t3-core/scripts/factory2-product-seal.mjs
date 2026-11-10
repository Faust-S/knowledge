#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const FACTORY2_PRODUCT_SEAL_SPECS=Object.freeze({
  'common-modules':Object.freeze({
    generation:2,
    predecessor:'Common Modules 0.4.1',
    roots:Object.freeze([
      'src/foundation',
      'src/workspace-contract',
      'src/workspace-host/context',
      'src/factory2/products/common-modules/common-modules.mjs',
    ]),
  }),
  'domain-keys':Object.freeze({
    generation:2,
    predecessor:'Domain Keys 2.4.5',
    roots:Object.freeze([
      'src/config/schemas/keys-2.0',
      'src/factory2/products/domain-keys/domain-keys.mjs',
      'scripts/verify-domain-keys-snapshot.mjs',
    ]),
  }),
  'domain-studio':Object.freeze({
    generation:2,
    predecessor:'Domain Studio R8.3 / alpha.9.11.0',
    roots:Object.freeze([
      'src/factory2/products/domain-studio',
      'src/factory2/apps/domain-studio',
      'studio.html',
    ]),
  }),
  'domain-engineering':Object.freeze({
    generation:2,
    predecessor:'Domain Engineering 8.4.x',
    roots:Object.freeze([
      'src/factory2/products/domain-engineering',
      'src/modules/base/features/domain-transformation',
      'scripts/factory2-domain-run-cli.mjs',
    ]),
  }),
});

const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const posix=(value)=>value.split(sep).join('/');

function walk(path){
  const s=statSync(path);
  if(s.isFile()) return [path];
  if(!s.isDirectory()) return [];
  return readdirSync(path,{withFileTypes:true})
    .flatMap((entry)=>walk(resolve(path,entry.name)));
}

export function buildFactory2ProductSeal(productId,{cwd=process.cwd()}={}){
  const spec=FACTORY2_PRODUCT_SEAL_SPECS[productId];
  if(!spec) throw new Error(`Unknown Factory 2 product seal id: ${productId}`);
  const files=spec.roots.flatMap((root)=>walk(resolve(cwd,root)))
    .map((absolute)=>({
      path:posix(relative(cwd,absolute)),
      sha256:sha256(readFileSync(absolute)),
    }))
    .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const paths=files.map((x)=>x.path);
  if(new Set(paths).size!==paths.length) throw new Error('duplicate Factory 2 seal path');
  const payload={
    schema:'IWXA_T2_FACTORY2_PRODUCT_FILE_SEAL_V1',
    productId,
    generation:2,
    predecessor:spec.predecessor,
    algorithm:'sha256(canonical-json(file-path+file-sha256 rows sorted by relative POSIX path))',
    files,
  };
  const sealSha256=sha256(Buffer.from(JSON.stringify(payload)));
  return Object.freeze({...payload,fileCount:files.length,sealSha256});
}

function main(){
  const productId=process.argv[2];
  if(!productId){
    console.error('usage: node scripts/factory2-product-seal.mjs <common-modules|domain-keys|domain-studio|domain-engineering>');
    process.exitCode=2;
    return;
  }
  console.log(JSON.stringify(buildFactory2ProductSeal(productId),null,2));
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href) main();
