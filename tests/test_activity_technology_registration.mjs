import test from 'node:test';
import assert from 'node:assert/strict';
import {planOriginalTechnologyRegistration} from '../modules/activity-base-anonymizer/technology-product-registration.node.mjs';
import {TECHNOLOGY_SERVICE,TECHNOLOGY_PASSPORT} from '../modules/activity-base-anonymizer/technology-product-passport.mjs';
import {TECHNOLOGY_SCHEMA} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {T3_ACTIVITY_OWNER_REVIEW_PASSPORT} from '../modules/activity-base-anonymizer/t3-owner-review-stage.mjs';
const base=()=>({domain:{modules:[],security:{allowed_object_classes:['iwxa.demo.note']}},
 catalog:{count:0,entries:[]},controlPlane:{schema_version:'0.3.1',services:[]}});
test('ordinary typed registration isolated from private Activity reviewer and idempotent',()=>{
 const r=planOriginalTechnologyRegistration(base());
 assert.equal(r.catalog.count,1);
 assert.deepEqual(planOriginalTechnologyRegistration(r),r);
 assert.equal(JSON.parse(r.passport_bytes).service_id,TECHNOLOGY_SERVICE);
 assert.deepEqual(TECHNOLOGY_PASSPORT.permissions.objects.read,[TECHNOLOGY_SCHEMA]);
 assert.deepEqual(TECHNOLOGY_PASSPORT.permissions.objects.write,[TECHNOLOGY_SCHEMA]);
 assert.equal(T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.packages.export,false);
 assert.equal(T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.packages.import,false);
 assert.ok(TECHNOLOGY_PASSPORT.permissions.packages.export);
});
test('reject service/path collision instead of changing the original registry',()=>{
 const b=base();b.domain.modules.push({service_id:TECHNOLOGY_SERVICE,base_path:'/wrong/'});
 assert.throws(()=>planOriginalTechnologyRegistration(b),{code:'TECHNOLOGY_ORIGINAL_CATALOG_COLLISION'});
});
