import {createHash} from 'node:crypto';
import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
export class Factory2ReleaseSubjectError extends Error {
  constructor(message,code='FACTORY2_RELEASE_SUBJECT_ERROR'){super(message);this.name='Factory2ReleaseSubjectError';this.code=code;}
}
export function canonicalFactory2ReleaseSubject(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2ReleaseSubjectError(message,'FACTORY2_RELEASE_SUBJECT_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2ReleaseSubjectError('release subject record required','FACTORY2_RELEASE_SUBJECT_INVALID');
  return out;
}
export function computeFactory2ReleaseSubjectSha256(value){
  const subject=canonicalFactory2ReleaseSubject(value);
  return createHash('sha256').update(Buffer.from(JSON.stringify(subject))).digest('hex');
}
