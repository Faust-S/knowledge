import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
const source = resolve(__dirname, "..");
const subjectRoot = resolve(source, "../kernel-successors/k036-atomic-graph");
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
describe("qualified Runtime 1.3 source identity", () => {
  it("binds every overlay byte and exact derived Kernel tree", () => {
    const subject = load(resolve(subjectRoot, "SOURCE_SUBJECT.json"));
    expect(subject.predecessor.sourcePackageSha256).toBe("1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73");
    for (const row of subject.overlay) expect(sha(readFileSync(resolve(subjectRoot, "source-overlay", row.path)))).toBe(row.successorSha256);
    expect(sha(Buffer.from(subject.inventory.map((row: { path: string; sha256: string }) => `${row.path}\0${row.sha256}\n`).join("")))).toBe(subject.sourceTreeSha256);
    const provenance = load(resolve(source, "src/kernel-client/contracts/runtime-1.3.0/PROVENANCE.json"));
    expect(provenance.source_tree_sha256).toBe(subject.sourceTreeSha256);
    expect(provenance.production_activation).toBe(false);
  });
  it("binds the successor snapshot byte inventory", () => {
    const dir = resolve(source, "src/kernel-client/contracts/runtime-1.3.0");
    const provenance = load(resolve(dir, "PROVENANCE.json"));
    for (const [path, expected] of Object.entries(provenance.files)) expect(sha(readFileSync(resolve(dir, path)))).toBe(expected);
    expect(provenance.contract_status).toBe("TECHNICALLY_QUALIFIED_SUCCESSOR_NOT_HUMAN_RELEASE_LOCKED");
  });
});
