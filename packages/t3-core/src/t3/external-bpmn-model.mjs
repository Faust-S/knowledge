// BPMN 2.0 source INSPECTION only. The original T3 Process Intelligence
// and Activity remain the sole owners of confirmed process observations.
// No BPMN engine, workflow runner, second Store or T3 sourceTruth is created.
const NS='http://www.omg.org/spec/BPMN/20100524/MODEL';
const ID=/^[A-Za-z_][A-Za-z0-9_.:-]{0,159}$/;
const TASKS=new Set(['task','userTask','serviceTask','scriptTask','manualTask',
  'businessRuleTask','sendTask','receiveTask','callActivity']);
const OTHER_NODES=new Set(['startEvent','endEvent','intermediateCatchEvent',
  'intermediateThrowEvent','exclusiveGateway','parallelGateway','inclusiveGateway']);
const COMPLEX=new Set(['subProcess','adHocSubProcess','transaction',
  'eventSubProcess','boundaryEvent','eventBasedGateway','complexGateway']);
const XML_MAX=262144,NODES_MAX=256,FLOWS_MAX=512;
function fail(code){throw Object.assign(new Error(code),{code});}
function checkedId(id,code='T3_BPMN_ID_INVALID'){
  if(typeof id!=='string'||!ID.test(id))fail(code);
  return id;
}
function elementChildren(node){return Array.from(node.children??[]);}
function modelChildren(node){return elementChildren(node).filter(x=>x.namespaceURI===NS);}
function sourceXml(xml,DomParser){
  if(typeof xml!=='string'||!xml.trim()||xml.length>XML_MAX)
    fail('T3_BPMN_SOURCE_LENGTH_INVALID');
  if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    fail('T3_BPMN_EXTERNAL_ENTITIES_FORBIDDEN');
  const Parser=DomParser??globalThis.DOMParser;
  if(typeof Parser!=='function')fail('T3_BPMN_DOM_PARSER_REQUIRED');
  let doc;
  try{doc=new Parser().parseFromString(xml,'application/xml');}
  catch{fail('T3_BPMN_XML_INVALID');}
  if(!doc?.documentElement||Array.from(doc.getElementsByTagName('*'))
    .some(x=>x.localName==='parsererror')||
    doc.documentElement.namespaceURI!==NS||
    doc.documentElement.localName!=='definitions')
    fail('T3_BPMN_XML_INVALID');
  return doc.documentElement;
}
function sourceProcess(root,requestedId){
  const processes=modelChildren(root).filter(x=>x.localName==='process');
  if(!processes.length)fail('T3_BPMN_PROCESS_REQUIRED');
  if(processes.length>16)fail('T3_BPMN_PROCESS_LIMIT');
  if(requestedId!=null)checkedId(requestedId,'T3_BPMN_PROCESS_ID_INVALID');
  const selection=requestedId==null?
    (processes.length===1?processes[0]:null):
    processes.find(x=>x.getAttribute('id')===requestedId);
  if(!selection)fail(requestedId==null
    ?'T3_BPMN_PROCESS_SELECTION_REQUIRED':'T3_BPMN_PROCESS_NOT_FOUND');
  return selection;
}
/** Parse an UNTRUSTED BPMN model in a browser DOMParser. No network access,
 * DTD/ENTITY expansion, script execution, process deployment or T3 write.
 * The caller's external source owner is authoritative ONLY when separately
 * verified by Agent; this function never grants that authority. */
export function inspectExternalBpmn2Model({
  xml,processId=null,DOMParser:DomParser=null,workspaceId=null,
}={}){
  if(workspaceId!=null&&(typeof workspaceId!=='string'||!workspaceId.trim()))
    fail('T3_BPMN_WORKSPACE_INVALID');
  const root=sourceXml(xml,DomParser);
  const selected=sourceProcess(root,processId);
  const selectedId=checkedId(selected.getAttribute('id'),'T3_BPMN_PROCESS_ID_INVALID');
  const nodes=new Map(),flows=[];
  const tasks=[];
  for(const node of modelChildren(selected)){
    const type=node.localName;
    if(COMPLEX.has(type))fail('T3_BPMN_UNSUPPORTED_CONTROL_FLOW');
    if(type==='sequenceFlow'){
      if(flows.length>=FLOWS_MAX)fail('T3_BPMN_FLOW_LIMIT');
      flows.push({
        id:checkedId(node.getAttribute('id')),
        from:checkedId(node.getAttribute('sourceRef'),'T3_BPMN_FLOW_REF_INVALID'),
        to:checkedId(node.getAttribute('targetRef'),'T3_BPMN_FLOW_REF_INVALID'),
        has_condition:modelChildren(node).some(x=>x.localName==='conditionExpression'),
      });
      continue;
    }
    if(!TASKS.has(type)&&!OTHER_NODES.has(type)){
      // Extensions are metadata and cannot implicitly become executable T3
      // nodes. Unsupported BPMN flow elements must fail closed.
      if(/(Task|Gateway|Event|Activity)$/.test(type))
        fail('T3_BPMN_UNSUPPORTED_CONTROL_FLOW');
      continue;
    }
    if(nodes.size>=NODES_MAX)fail('T3_BPMN_NODE_LIMIT');
    const id=checkedId(node.getAttribute('id'));
    if(nodes.has(id))fail('T3_BPMN_NODE_DUPLICATE');
    nodes.set(id,type);
    if(TASKS.has(type)){
      if(tasks.length>=128)fail('T3_BPMN_TASK_LIMIT');
      tasks.push(Object.freeze({
        id,name:node.getAttribute('name')||id,bpmn_type:type,
        execution_status:'NOT_OBSERVED',
      }));
    }
  }
  if(!nodes.size||!tasks.length)fail('T3_BPMN_TASK_REQUIRED');
  const flowIds=new Set();
  for(const f of flows){
    if(flowIds.has(f.id)||nodes.has(f.id))fail('T3_BPMN_FLOW_ID_DUPLICATE');
    flowIds.add(f.id);
    if(!nodes.has(f.from)||!nodes.has(f.to))
      fail('T3_BPMN_FLOW_REF_UNRESOLVED');
  }
  return Object.freeze({
    schema:'IWXA_T3_BPMN2_MODEL_CANDIDATE_V1',
    status:'UNTRUSTED_MODEL_NOT_EXECUTED',sourceTruth:false,derived:true,
    observed:false,requiresOwnerReview:true,
    bpmnNamespace:NS,processId:selectedId,
    processName:selected.getAttribute('name')||selectedId,
    bpmnExecutableFlag:selected.getAttribute('isExecutable')==='true',
    workspaceId,
    activityIds:Object.freeze(tasks.map(x=>x.id)),
    tasks:Object.freeze(tasks),
    flowNodes:Object.freeze([...nodes.entries()].map(([id,type])=>
      Object.freeze({id,bpmn_type:type}))),
    sequenceFlows:Object.freeze(flows.map(x=>Object.freeze(x))),
    flowOrderAuthority:'MODEL_ONLY_NOT_OBSERVED',
  });
}
/** Compare proposed BPMN task IDs with the ORIGINAL IWXA T2/T3 process
 * definition. Never infer operation order or process conformance from XML.
 * Execution requires separately observed source events with provenance. */
export function compareExternalBpmn2ToProcessDefinition({candidate,definition}={}){
  if(candidate?.schema!=='IWXA_T3_BPMN2_MODEL_CANDIDATE_V1'||
    candidate.status!=='UNTRUSTED_MODEL_NOT_EXECUTED'||
    candidate.sourceTruth!==false||candidate.observed!==false||
    definition?.schema!=='IWXA_T2_PROCESS_DEFINITION_V1'||
    definition.objectKind!=='processDefinition'||
    definition.sourceTruth!==true||!Array.isArray(definition.activityIds))
    fail('T3_BPMN_ORIGINAL_PROCESS_DEFINITION_REQUIRED');
  if(candidate.workspaceId===null||
    candidate.workspaceId!==definition.workspaceId)
    fail('T3_BPMN_WORKSPACE_MISMATCH');
  const actual=new Set(candidate.activityIds);
  const canonical=new Set(definition.activityIds);
  const missing=[...canonical].filter(x=>!actual.has(x)).sort();
  const added=[...actual].filter(x=>!canonical.has(x)).sort();
  return Object.freeze({
    schema:'IWXA_T3_BPMN2_MODEL_MATCH_V1',
    candidate_status:'UNTRUSTED_MODEL_NOT_EXECUTED',
    processDefinitionId:definition.definitionId,
    processDefinitionVersion:definition.versionId,
    bpmnProcessId:candidate.processId,
    status:missing.length||added.length?'REVIEW_MAPPING':'TASK_IDS_MATCH',
    missingTaskIds:Object.freeze(missing),
    extraTaskIds:Object.freeze(added),
    executionObserved:false,
    conformance:'NOT_EVALUATED',
  });
}
