import test from "node:test";
import assert from "node:assert/strict";
import {AgentLocalModelAdapter} from "../integration-sources/bli1/policy.mjs";

const code="iwxa-local-v1:8765:"+"a".repeat(43),identity="b".repeat(64);
const status={schema:"iwxa.agent-local-model/1",ready:true,model:"Qwen3-0.6B.gguf",model_identity:identity};
const reply=text=>({schema:status.schema,model_identity:identity,remote_fallback:false,text});
const response=value=>({ok:true,json:async()=>value});
test("Agent adapter contacts only exact local route and never sends the Agent session credential",async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return response(calls.length===1?status:reply("answer"));};
  try{
    const model=new AgentLocalModelAdapter(code);
    assert.equal(model.ready,false);
    assert.deepEqual(await model.connect(),{model:status.model});
    assert.equal(model.ready,true);
    assert.equal(await model.invoke("question",{maxTokens:64}),"answer");
    assert.deepEqual(calls.map(c=>c.url),["http://127.0.0.1:8765/api/t3-local-model/status","http://127.0.0.1:8765/api/t3-local-model/invoke"]);
    for(const {init} of calls){
      assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");assert.equal(init.mode,"cors");
      assert.equal(init.headers["X-IWXA-Model-Token"],"a".repeat(43));
      assert.equal(Object.hasOwn(init.headers,"X-IWXA-Session-Token"),false);
    }
    assert.deepEqual(JSON.parse(calls[1].init.body),{prompt:"question",max_tokens:64,model_identity:identity});
    model.dispose();assert.equal(model.ready,false);
  }finally{globalThis.fetch=original;}
});
test("Agent structured results use the exact existing allowed field schema",async()=>{
  const original=globalThis.fetch;
  let next=status;
  globalThis.fetch=async()=>response(next);
  try{
    const model=new AgentLocalModelAdapter(code);await model.connect();
    const formFields=[{key:"field_1",choices:["A","B"]},{key:"field_2"}];
    next=reply('{"fields":{"field_1":"A","field_2":"text"}}');
    assert.equal(await model.invoke("form",{formFields}),next.text);
    for(const bad of ['{"fields":{"field_1":"X"}}','{"fields":{"field_3":"A"}}','{"fields":{"field_2":7}}','{"fields":{},"extra":true}','not JSON']){
      next=reply(bad);await assert.rejects(model.invoke("form",{formFields}),{code:"FORM_GRAMMAR_FAILED"});
      assert.equal(model.ready,true);
    }
    next=reply('{"fields":{}}');assert.equal(await model.invoke("form",{formFields}),next.text);
    model.dispose();
  }finally{globalThis.fetch=original;}
});
test("invalid code or changed local model cannot cause a remote fallback or repeated request",async()=>{
  const original=globalThis.fetch;let count=0;
  globalThis.fetch=async()=>{count++;return response(count===1?status:{...reply("wrong"),model_identity:"c".repeat(64)});};
  try{
    assert.throws(()=>new AgentLocalModelAdapter("https://example.com"),{code:"AGENT_LOCAL_CODE_INVALID"});
    assert.equal(count,0);
    const model=new AgentLocalModelAdapter(code);await model.connect();
    await assert.rejects(model.invoke("question"),{code:"AGENT_LOCAL_UNAVAILABLE"});
    assert.equal(model.ready,false);
    await assert.rejects(model.invoke("question"),{code:"AGENT_LOCAL_UNAVAILABLE"});
    assert.equal(count,2);
  }finally{globalThis.fetch=original;}
});
test("cancellation stops browser wait without automatically repeating or switching model",async()=>{
  const original=globalThis.fetch;let count=0;
  globalThis.fetch=async(url,init)=>{
    count++;if(count===1)return response(status);
    return new Promise((resolve,reject)=>init.signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true}));
  };
  try{
    const model=new AgentLocalModelAdapter(code);await model.connect();
    const pending=model.invoke("question");
    model.cancel();await assert.rejects(pending,{code:"CANCELLED"});
    assert.equal(count,2);assert.equal(model.ready,true);
  }finally{globalThis.fetch=original;}
});
