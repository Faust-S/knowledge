import test from "node:test";
import assert from "node:assert/strict";
import { isCurrentProductRuntime } from "../src/factory2/products/domain-completion/product-completion.mjs";

test("universal product gate permits only qualified Kernel 0.3.6 / Contract 1.3.0", () => {
  assert.equal(isCurrentProductRuntime({kernel:"0.3.6",contract:"1.3.0"}),true);
  for(const runtime of [
    {kernel:"0.3.5",contract:"1.2.0"},
    {kernel:"0.3.6",contract:"1.2.0"},
    {kernel:"0.3.5",contract:"1.3.0"},
    {kernel:"0.3.7",contract:"1.3.0"},
    null,{},undefined,
  ]) assert.equal(isCurrentProductRuntime(runtime),false,JSON.stringify(runtime));
});
