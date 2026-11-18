import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyOriginalAgentD3Source,qualifyOriginalAgentWithAllowedTokens,AGENT_ORIGINAL_PIN}
  from '../scripts/qualify-original-agent-d3-port.mjs';

test('Agent private employee source has exact non-branch code pin',()=>{
  assert.match(AGENT_ORIGINAL_PIN,/^[a-f0-9]{40}$/);
});

test('refuse missing scoped Agent private read token without network',async()=>{
  let calls=0;
  await assert.rejects(qualifyOriginalAgentD3Source({
    token:'',fetchFile:async()=>{calls++;return Buffer.alloc(0);},
  }),{message:'T3_AGENT_PRIVATE_SOURCE_TOKEN_UNAVAILABLE'});
  assert.equal(calls,0);
});

test('only two original Agent modules, no subprocess credentials or source output',async()=>{
  const script=[
    'import os, unittest',
    'class Demo(unittest.TestCase):',
    ' def test_uncertain_native_write_blocks_waiting_consequential_request(self):',
    '  """An original unittest multi-line shortDescription must not hide PASS."""',
    '  self.assertIsNone(os.getenv("AGENT_PRIVATE_READ_TOKEN"))',
    '  self.assertIsNone(os.getenv("T3_READ_TOKEN"))',
    '  self.assertTrue(True)',
    'for n in range(10):',
    ' setattr(Demo, "test_extra_"+str(n), lambda self:self.assertTrue(True))',
  ].join('\n')+'\n';
  const files={
    'runtime/t3_original_employee_port.py':Buffer.from('class OriginalEmployeePort: pass\n'),
    'tests/test_agent06_corporate_t3_employee.py':Buffer.from(script),
  };
  const asked=[];
  const result=await qualifyOriginalAgentD3Source({
    token:'fake-credential-not-in-subprocess',
    fetchFile:async(path,token)=>{
      assert.equal(token,'fake-credential-not-in-subprocess');
      asked.push(path);
      assert.ok(Object.hasOwn(files,path));
      return files[path];
    },
  });
  assert.deepEqual(asked,Object.keys(files));
  assert.equal(result.tests,11);
  assert.equal(result.files,2);
});

test('oversized original Agent source is rejected before executing Python',async()=>{
  await assert.rejects(qualifyOriginalAgentD3Source({
    token:'fake',
    fetchFile:async()=>Buffer.alloc(129*1024),
  }),{message:'T3_AGENT_PRIVATE_SOURCE_FILE_INVALID'});
});

test('fallback uses only already granted credentials and never clones repository',async()=>{
  const requested=[];
  const fixtures={
    'runtime/t3_original_employee_port.py':Buffer.from('class OriginalEmployeePort: pass\n'),
    'tests/test_agent06_corporate_t3_employee.py':Buffer.from([
      'import unittest',
      'class TestReceipt(unittest.TestCase):',
      ' def test_uncertain_native_write_blocks_waiting_consequential_request(self):',
      '  """This description is printed separately in unittest verbose mode."""',
      '  self.assertTrue(True)',
      'for i in range(10):',
      ' setattr(TestReceipt,"test_case_"+str(i),lambda self:self.assertTrue(True))',
    ].join('\n')+'\n'),
  };
  const result=await qualifyOriginalAgentWithAllowedTokens({
    tokens:['denied-credential','allowed-credential'],
    fetchFile:async(path,token)=>{
      requested.push([path,token]);
      if(token==='denied-credential')throw Error('T3_PRIVATE_SOURCE_FETCH_404');
      return fixtures[path];
    },
  });
  assert.equal(result.tests,11);
  assert.deepEqual(requested.map(item=>item[1]),
    ['denied-credential','allowed-credential','allowed-credential']);
});
