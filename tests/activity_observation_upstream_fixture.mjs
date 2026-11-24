import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const [root,kind]=process.argv.slice(2);
if(!['arx','opendp'].includes(kind))throw new Error('invalid fixture mode');
const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
const c=prepareD05DisclosureCandidate(r,r.groups[0].id,1,{
 purpose:'Cut and inspect',inputs:'Sheet metal',outputs:'Part',applicability:'Drawing',
 adaptation_guidance:'Recalculate for recipient',local_context_guidance:'Use approved drawing',
},{});
const common={technology_sha256:await sha256Canonical(c.technology),observation_unit:'ORGANIZATION',source_kind:'DECLARED_MODEL'};
const request=kind==='arx'?{...common,profile:'ACTIVITY_ARX_COHORT_V1',k:2,
 columns:[{key:'machine_class',hierarchy:[['a','laser'],['b','laser'],['c','mill'],['d','mill']],max_level:1}],
 rows:[...'abcd'].map((v,i)=>({unit_id:'org'+i,values:[v]}))}:
 {...common,profile:'ACTIVITY_DP_AGGREGATE_V1',metric:'ACCEPTED_ORDER_COUNT',public_bound:20,epsilon_milli:500,
 rows:[0,2,12,50].map((v,i)=>({unit_id:'org'+i,value:v}))};
mkdirSync(root,{recursive:true});writeFileSync(join(root,'request.json'),JSON.stringify(request)+'\n','utf8');
