// Fixed local Activity operations for the existing Agent U01 adapter.
import {groupPersonalRoutineEvidence,preparePersonalTechnologyProduct,prepareD05TechnologyProduct,
 preparePersonalRecipientActivation,prepareD05RecipientInputs} from '../modules/activity-base-anonymizer/technology-product.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const operations={
 '--personal-group':{keys:['records'],run:v=>groupPersonalRoutineEvidence(v.records)},
 '--personal-product':{keys:['records','variant_id','proposal'],run:v=>preparePersonalTechnologyProduct(v.records,v.variant_id,v.proposal)},
 '--d05-product':{keys:['candidate','title'],run:v=>prepareD05TechnologyProduct(v.candidate,v.title)},
 '--personal-recipient':{keys:['product','binding'],run:v=>preparePersonalRecipientActivation(v.product,v.binding)},
 '--d05-recipient':{keys:['product','binding'],run:v=>prepareD05RecipientInputs(v.product,v.binding)},
};
try{
 const args=process.argv.slice(2);
 if(args.length!==1||!Object.hasOwn(operations,args[0]))fail('TECHNOLOGY_CLI_OPERATION_INVALID');
 const chunks=[];let len=0;
 for await(const part of process.stdin){
  const b=Buffer.from(part);len+=b.length;if(len>8*1024*1024)fail('TECHNOLOGY_CLI_INPUT_LIMIT');chunks.push(b);
 }
 let v;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{fail('TECHNOLOGY_CLI_INVALID_JSON');}
 const op=operations[args[0]];
 if(!exact(v,op.keys))fail('TECHNOLOGY_CLI_PROFILE');
 const value=await op.run(v),out=JSON.stringify(value);
 if(Buffer.byteLength(out,'utf8')>4*1024*1024)fail('TECHNOLOGY_CLI_OUTPUT_LIMIT');
 process.stdout.write(out+'\n');
}catch(e){
 const code=typeof e?.code==='string'&&/^TECHNOLOGY_[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'TECHNOLOGY_CLI_FAILED';
 process.stdout.write(JSON.stringify({status:'HOLD',code,anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null})+'\n');
 process.exitCode=2;
}
