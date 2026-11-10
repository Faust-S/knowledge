import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const doc = readFileSync(join(process.cwd(), "ARCHITECTURE_LOCK.md"), "utf8");

describe("ARCHITECTURE_LOCK.md (Factory 2 current)", () => {
  const required = [
    "IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2",
    "Kernel target: `0.3.5`",
    "iwxa.workspace",
    "/workspace/exchange/",
    "/workspace/lifecycle/",
    "/workspace/studio/",
    "OWNER_SUPPLIED_AT_TEST_TIME",
    "generic common Result writer",
    "Owner approval must never be synthesized",
  ];
  for (const phrase of required) {
    it(`contains "${phrase}"`, () => {
      expect(doc).toContain(phrase);
    });
  }

  const forbidden = [
    "Kernel 0.2.7",
    "0.34.0-rc.6",
    "Exchange planned",
    "Lifecycle planned",
  ];
  for (const phrase of forbidden) {
    it(`does not contain "${phrase}"`, () => {
      expect(doc).not.toContain(phrase);
    });
  }
});
