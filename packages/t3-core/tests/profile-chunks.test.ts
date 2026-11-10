import {describe,it,expect} from "vitest";
import {buildBaseViewerContributions} from "../src/modules/base/viewers";
describe("lazy Host viewer composition",()=>{
 it("declares lazy loaders for every built-in presentation",()=>{
  const all=buildBaseViewerContributions();
  expect(all).toHaveLength(48);
  for(const v of all)expect(typeof v.loader).toBe("function");
 });
});
