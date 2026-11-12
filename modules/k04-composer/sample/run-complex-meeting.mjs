import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {solution,sampleAvailability,extractStructuredMeeting} from './open-host.mjs';
import {prepareMeetingProcess,renderMeetingDocuments} from '../meeting-process.mjs';
import {publishMeetingDocuments} from '../meeting-document-host.mjs';

export async function runComplexMeetingSample({transcript,outputDirectory}={}){
  const source=transcript??await readFile(new URL('meeting-case-05.txt',import.meta.url),'utf8');
  const directory=outputDirectory??await mkdtemp(join(tmpdir(),'iwxa-k04-user-outcome-'));
  const task={taskId:'OPEN-HOST-MEETING-CASE-05',kind:'meeting_followup',
    input:{transcript_text:source},
    source:{ref:'modules/k04-composer/sample/meeting-case-05.txt',
      revision:'fixture-2026-11-12',rights:'AUTHOR_OWNED_SYNTHETIC',authorized:true}};
  const start=performance.now();
  const process=prepareMeetingProcess({task,solution,available:sampleAvailability()});
  const pack=renderMeetingDocuments(process);
  const written=await publishMeetingDocuments(process,{directory});
  const elapsedMs=performance.now()-start;
  // Baseline is the existing open-host structured-rule Skill, NOT a tested LLM.
  const baselineStart=performance.now();
  const baseline=extractStructuredMeeting(source);
  const baselineMs=performance.now()-baselineStart;
  const expectedActions=[
    'Подготовить уточнённый бюджет пилота',
    'Проверить резервное копирование тестового контура',
    'Составить протокол приёмочных испытаний',
    'Подготовить инструкцию службы поддержки'];
  const extracted=new Set(process.extraction.draft.action_items.map(x=>x.action));
  const matched=expectedActions.filter(x=>extracted.has(x)).length;
  return {taskRef:task.taskId,outputDirectory:directory,
    processStatus:process.status,
    documents:written.files.map(x=>({name:x.name,status:x.status,bytes:x.bytes,
      digest:x.contentDigest})),actualWrites:written.documentsCreated,
    observedReadbacks:written.files.length,
    measurements:{extractionExpected:expectedActions.length,extractionMatched:matched,
      extractionRecallOnAuthoredFixture:matched/expectedActions.length,
      documentsExpected:Object.keys(pack.documents).length,
      documentsValidated:written.files.length,
      humanCorrectionsMeasured:false,humanCorrections:'NOT_MEASURED',
      hostElapsedMs:elapsedMs,baselineRulesMs:baselineMs,
      baselineRulesExtracted:baseline.action_items.length,
      modelSkillsBaseline:'NOT_EXECUTED',
      modelInference:'NOT_EXECUTED'},
    humanReview:'PENDING',employeeReports:'NOT_SUBMITTED',
    assignmentsExecuted:false,goalComplete:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runComplexMeetingSample({outputDirectory:process.env.K04_OUTPUT_DIRECTORY});
  process.stdout.write(JSON.stringify(result)+'\n');
}
