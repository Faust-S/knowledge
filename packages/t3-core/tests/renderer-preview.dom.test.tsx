// @vitest-environment jsdom
import {describe,it,expect} from "vitest";
import {truncatePreviewText} from "../src/renderers/preview";
import {buildBaseViewerContributions} from "../src/modules/base/viewers";
describe("built-in viewer previews",()=>{
 it("truncates long strings",()=>expect(truncatePreviewText("a".repeat(500),50)?.length).toBeLessThanOrEqual(51));
 it("provides 24 previews and 24 details",()=>{
  const x=buildBaseViewerContributions();expect(x.filter(v=>v.surface==="preview")).toHaveLength(24);expect(x.filter(v=>v.surface==="detail")).toHaveLength(24);
 });
});
