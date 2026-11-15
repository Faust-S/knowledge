import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeProcessDefinition}
  from '../src/modules/base/features/project-process/project-process.mjs';
import {inspectExternalBpmn2Model,compareExternalBpmn2ToProcessDefinition}
  from '../src/t3/external-bpmn-model.mjs';

const Parser=new JSDOM('<!doctype html><html></html>').window.DOMParser;
const ns='http://www.omg.org/spec/BPMN/20100524/MODEL';
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${ns}"
  xmlns:flowable="http://flowable.org/bpmn">
  <bpmn:process id="CehoVodOrder" name="CehoVod Order" isExecutable="true">
    <bpmn:startEvent id="start"/>
    <bpmn:userTask id="review" name="Order review" flowable:assignee="user"/>
    <bpmn:serviceTask id="produce" name="Produce">
      <bpmn:extensionElements><flowable:field name="connector"/></bpmn:extensionElements>
    </bpmn:serviceTask>
    <bpmn:exclusiveGateway id="check"/>
    <bpmn:endEvent id="end"/>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="produce"/>
    <bpmn:sequenceFlow id="f3" sourceRef="produce" targetRef="check"/>
    <bpmn:sequenceFlow id="f4" sourceRef="check" targetRef="end"/>
  </bpmn:process>
</bpmn:definitions>`;
const inspect=source=>inspectExternalBpmn2Model({
  xml:source,DOMParser:Parser,workspaceId:'ws:cehovod',
});
test('Flowable BPMN 2.0 imports only as untrusted model, not an execution fact',()=>{
  const model=inspect(xml);
  assert.equal(model.status,'UNTRUSTED_MODEL_NOT_EXECUTED');
  assert.equal(model.sourceTruth,false);
  assert.equal(model.observed,false);
  assert.equal(model.requiresOwnerReview,true);
  assert.equal(model.bpmnExecutableFlag,true);
  assert.equal(model.processId,'CehoVodOrder');
  assert.deepEqual(model.activityIds,['review','produce']);
  assert.equal(model.sequenceFlows.length,4);
  assert.equal(model.tasks[1].execution_status,'NOT_OBSERVED');
  assert.equal(JSON.stringify(model).includes('flowable:assignee'),false);
  assert.throws(()=>model.tasks.push({}),TypeError);
});
test('exact canonical original IWXA process task IDs match without inventing conformance',()=>{
  const candidate=inspect(xml);
  const canonical=normalizeProcessDefinition({
    workspaceId:'ws:cehovod',definitionId:'t3:cehovod',
    versionId:'3',name:'Order',domainApplicability:['d05'],
    activityIds:['produce','review'],
  });
  const matched=compareExternalBpmn2ToProcessDefinition({candidate,definition:canonical});
  assert.equal(matched.status,'TASK_IDS_MATCH');
  assert.equal(matched.executionObserved,false);
  assert.equal(matched.conformance,'NOT_EVALUATED');
  assert.deepEqual(matched.missingTaskIds,[]);
  const changed=normalizeProcessDefinition({
    workspaceId:'ws:cehovod',definitionId:'t3:cehovod',
    versionId:'4',name:'Order',domainApplicability:['d05'],
    activityIds:['review','inspectResult'],
  });
  const diff=compareExternalBpmn2ToProcessDefinition({candidate,definition:changed});
  assert.equal(diff.status,'REVIEW_MAPPING');
  assert.deepEqual(diff.missingTaskIds,['inspectResult']);
  assert.deepEqual(diff.extraTaskIds,['produce']);
  assert.equal(diff.conformance,'NOT_EVALUATED');
});
test('BPMN imported XML can never be mistaken for canonical sourceTruth',()=>{
  const candidate=inspect(xml);
  const fakeDefinition={schema:'IWXA_T2_PROCESS_DEFINITION_V1',
    objectKind:'processDefinition',workspaceId:'ws:cehovod',
    sourceTruth:false,activityIds:['review','produce'],
  };
  assert.throws(()=>compareExternalBpmn2ToProcessDefinition({
    candidate,definition:fakeDefinition,
  }),{code:'T3_BPMN_ORIGINAL_PROCESS_DEFINITION_REQUIRED'});
  const canonical=normalizeProcessDefinition({
    workspaceId:'other',definitionId:'abc',versionId:'v1',
    name:'Order',domainApplicability:['d05'],activityIds:['review'],
  });
  assert.throws(()=>compareExternalBpmn2ToProcessDefinition({candidate,definition:canonical}),
    {code:'T3_BPMN_WORKSPACE_MISMATCH'});
});
test('BPMN rejects DTD, entity expansion, invalid and oversized XML',()=>{
  const withEntity=`<!DOCTYPE definitions [<!ENTITY secret SYSTEM "file:///etc/passwd">]>${xml}`;
  assert.throws(()=>inspect(withEntity),{code:'T3_BPMN_EXTERNAL_ENTITIES_FORBIDDEN'});
  assert.throws(()=>inspect('<not-xml>'),{code:'T3_BPMN_XML_INVALID'});
  assert.throws(()=>inspect('X'.repeat(262145)),{code:'T3_BPMN_SOURCE_LENGTH_INVALID'});
  assert.throws(()=>inspectExternalBpmn2Model({xml,workspaceId:'ws:cehovod',
    DOMParser:null}),
    globalThis.DOMParser?()=>true:{code:'T3_BPMN_DOM_PARSER_REQUIRED'});
});
test('BPMN rejects ambiguous process selection and allows exact process selection',()=>{
  const duplicated=xml.replace('</bpmn:definitions>',
    '<bpmn:process id="Other"><bpmn:task id="T"/></bpmn:process></bpmn:definitions>');
  assert.throws(()=>inspect(duplicated),{code:'T3_BPMN_PROCESS_SELECTION_REQUIRED'});
  assert.equal(inspectExternalBpmn2Model({
    xml:duplicated,DOMParser:Parser,workspaceId:'ws:cehovod',
    processId:'Other',
  }).activityIds[0],'T');
  assert.throws(()=>inspectExternalBpmn2Model({
    xml:duplicated,DOMParser:Parser,workspaceId:'ws:cehovod',
    processId:'Unknown',
  }),{code:'T3_BPMN_PROCESS_NOT_FOUND'});
});
test('BPMN fails closed for missing references, duplicate tasks and nested subprocess',()=>{
  assert.throws(()=>inspect(xml.replace('targetRef="produce"','targetRef="not-known"')),
    {code:'T3_BPMN_FLOW_REF_UNRESOLVED'});
  assert.throws(()=>inspect(xml.replace('<bpmn:exclusiveGateway id="check"/>',
    '<bpmn:userTask id="review"/>')),
    {code:'T3_BPMN_NODE_DUPLICATE'});
  assert.throws(()=>inspect(xml.replace('<bpmn:exclusiveGateway id="check"/>',
    '<bpmn:subProcess id="sub"/>')),
    {code:'T3_BPMN_UNSUPPORTED_CONTROL_FLOW'});
});
