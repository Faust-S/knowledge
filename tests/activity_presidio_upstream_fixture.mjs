import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const root=process.argv[2];
mkdirSync(root,{recursive:true});
const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
const c=prepareD05DisclosureCandidate(r,r.groups[0].id,1,{
 purpose:'📋 Contact quality@example.com. Иван Иванов в Москве.',
 inputs:'Sheet metal',outputs:'Деталь',applicability:'Согласно чертежу',
 adaptation_guidance:'Recalculate for the recipient',local_context_guidance:'Use the approved technical drawing',
}, {});
writeFileSync(join(root,'candidate.json'),JSON.stringify(c)+'\n','utf8');

import {personalRows,personalProposal,d05Candidate} from './activity_technology_product_fixture.mjs';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
const proposal={...personalProposal(),title:'📋 Weekly review quality@example.com'};
const personal=await preparePersonalTechnologyProduct(personalRows(),'routine_001',proposal);
const d05=await prepareD05TechnologyProduct(d05Candidate(),'📋 Technology quality@example.com');
writeFileSync(join(root,'personal-product.json'),JSON.stringify(personal)+'\n','utf8');
writeFileSync(join(root,'d05-product.json'),JSON.stringify(d05)+'\n','utf8');
