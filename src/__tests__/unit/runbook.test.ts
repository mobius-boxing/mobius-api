import { describe, it, expect, beforeAll } from "@jest/globals";
import fs from "fs";
import path from "path";

/**
 * `repos/docs/tenant-cutover-runbook.md` (db-per-company brief T11, AC-70,
 * AC-87, AC-88) — mechanical checks only; the prose is reviewed by a human.
 *
 * Reads the STAGED copy, not the live path: this feature has not reached a
 * deploy, and `repos/docs` is a non-git, live-read directory shared by other
 * sessions (D-91). The live path is copied from
 * `docs/dev/db-per-company/t11-staged/tenant-cutover-runbook.md` only in the
 * integration step, after the human's commit yes.
 */

const RUNBOOK_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "docs",
  "dev",
  "db-per-company",
  "t11-staged",
  "tenant-cutover-runbook.md",
);

const MARKERS = ["[HUMAN-RUN]", "[AGENT-RUN: local only]"] as const;
const STEP_LINE = /^\s*\d+\.\s+(\[[^\]]+\])/;
const PROD_TOUCHING = /ssh|docker |aws |s3:\/\/|deploy/;

describe("tenant-cutover-runbook.md (AC-70, AC-87, AC-88)", () => {
  let text: string;
  let lines: string[];

  beforeAll(() => {
    expect(fs.existsSync(RUNBOOK_PATH)).toBe(true);
    text = fs.readFileSync(RUNBOOK_PATH, "utf8");
    lines = text.split("\n");
  });

  it("AC-70: sections appear in the exact required order", () => {
    const required = [
      "## P-pre",
      "## P —",
      "## C1",
      "## C2 — 15 QA DEMO CO",
      "## C2 — 6 Corrugadora Rio Negro",
      "## C2 — 3 Rol-Pel",
      "## C3",
      "## C4",
    ];
    const indices = required.map((heading) => {
      const index = lines.findIndex((line) => line.startsWith(heading));
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    });
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
    }
  });

  it("AC-70: each section has Preconditions, Commands, Evidence and Rollback", () => {
    const sectionHeadingIndices = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith("## "));
    for (let i = 0; i < sectionHeadingIndices.length; i += 1) {
      const start = sectionHeadingIndices[i]!.index;
      const end = sectionHeadingIndices[i + 1]?.index ?? lines.length;
      const body = lines.slice(start, end).join("\n");
      expect(body).toMatch(/### Preconditions/);
      expect(body).toMatch(/### Commands/);
      expect(body).toMatch(/### Evidence to capture \(L-017\)/);
      expect(body).toMatch(/### Rollback/);
    }
  });

  it("AC-70: each C2 section names its company by uuid", () => {
    const uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const heading of [
      "## C2 — 15 QA DEMO CO",
      "## C2 — 6 Corrugadora Rio Negro",
      "## C2 — 3 Rol-Pel",
    ]) {
      const index = lines.findIndex((line) => line.startsWith(heading));
      expect(lines[index]).toMatch(uuidPattern);
    }
  });

  it("AC-70: the C1 section states the prod schema-parity check", () => {
    expect(text).toMatch(/schema-parity/i);
  });

  it("AC-70: C3/C4 carry the verbatim park/drop migration text", () => {
    expect(text).toMatch(/park_tenant_tables\.ts/);
    expect(text).toMatch(/ALTER TABLE .* RENAME TO/);
    expect(text).toMatch(/drop_zz_old_tables\.ts/);
    expect(text).toMatch(/DROP TABLE IF EXISTS/);
  });

  it("AC-70: C3 carries the ownership DO-loop and a backup precondition", () => {
    expect(text).toMatch(/DO \$\$ DECLARE r record/);
    expect(text).toMatch(/ALTER .* OWNER TO mobius_core_user/);
    expect(text).toMatch(/[Bb]ackup precondition/);
  });

  it("AC-70: states the never-concurrent-with-split-T8-or-a-deploy rule", () => {
    expect(text).toMatch(/[Nn]ever concurrent/);
    expect(text).toMatch(/split T8/i);
  });

  it('AC-70: "REASSIGN OWNED" and "migrate:rollback" appear only on lines that also say "forbidden"', () => {
    for (const line of lines) {
      if (/REASSIGN OWNED|migrate:rollback/.test(line)) {
        expect(line).toMatch(/forbidden/i);
      }
    }
  });

  it("never mentions export-workflows (gate 2: nothing is exported)", () => {
    expect(text).not.toMatch(/export-workflows/);
  });

  it("AC-87: P-pre/P carry the D-63 image precondition, the gate-2 answers, the on-box rehearsal, the window sequence, the post-window check, the in-window rollback, D-67 and D-68", () => {
    const pIndex = lines.findIndex((line) => line.startsWith("## P —"));
    const c1Index = lines.findIndex((line) => line.startsWith("## C1"));
    const ppreThroughP = lines.slice(0, c1Index).join("\n");

    expect(ppreThroughP).toMatch(/origin\/master/);
    expect(ppreThroughP).toMatch(/audit_maintenance/);
    expect(ppreThroughP).toMatch(
      /nf_node_runs.*nf_runs.*nf_documents.*nf_workflow_credentials.*nf_workflows.*nf_credentials/,
    );
    expect(ppreThroughP).toMatch(/dist\/scripts/);

    expect(ppreThroughP).toMatch(/A-1 → A/);
    expect(ppreThroughP).toMatch(/A-2 → A/);
    expect(ppreThroughP).toMatch(/A-3 → A/);

    expect(ppreThroughP).toMatch(/scratch_purge_check/);
    const nfOrphanMentions = ppreThroughP.match(/nf_workflows/g) ?? [];
    expect(nfOrphanMentions.length).toBeGreaterThanOrEqual(2); // before AND after purge-gate

    expect(ppreThroughP).toMatch(/--hold/);
    expect(ppreThroughP).toMatch(/pg_dump -Fc --snapshot/);
    expect(ppreThroughP).toMatch(/x-amz-meta-snapshot-id|--metadata/);
    expect(ppreThroughP).toMatch(/archive-s3.*--copy-only/);
    expect(ppreThroughP).toMatch(
      /purge-companies\.js.*425f62b4.*22406d12.*6e26db6c.*8cade8c9/,
    );
    expect(ppreThroughP).toMatch(/archive-s3.*--delete-source/);
    expect(ppreThroughP).toMatch(/purge-gate/);
    expect(ppreThroughP).toMatch(/docker start traffic-api/);
    expect(ppreThroughP).toMatch(/health/i);

    expect(ppreThroughP).toMatch(/Post-window/);

    expect(ppreThroughP).toMatch(/pg_restore -d traffic_production/);

    expect(ppreThroughP).toMatch(/D-67 NULL-company triage/);

    expect(ppreThroughP).toMatch(/D-68 note/);
    expect(ppreThroughP).toMatch(/404/);

    void pIndex;
  });

  it("AC-87: the inventory ballpark numbers are labelled prose, never a gate", () => {
    const contextIndex = lines.findIndex((line) =>
      line.startsWith("Context (prose"),
    );
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(lines[contextIndex]).toMatch(/never a gate/);
  });

  it("AC-88: purge-gate is invoked with --snapshot and --dump on the same line", () => {
    const gateLines = lines.filter((line) => line.includes("purge-gate"));
    const withBoth = gateLines.filter(
      (line) => line.includes("--snapshot") && line.includes("--dump"),
    );
    expect(withBoth.length).toBeGreaterThan(0);
  });

  it("AC-88: every numbered step line carries exactly one marker", () => {
    const stepLines = lines.filter((line) => /^\s*\d+\.\s+/.test(line));
    expect(stepLines.length).toBeGreaterThan(0);
    for (const line of stepLines) {
      const hits = MARKERS.filter((marker) => line.includes(marker));
      expect(hits.length).toBe(1);
    }
  });

  it("AC-88: every step touching ssh/docker/aws/s3/deploy is [HUMAN-RUN]", () => {
    const stepLines = lines.filter((line) => STEP_LINE.test(line));
    for (const line of stepLines) {
      if (PROD_TOUCHING.test(line)) {
        expect(line).toContain("[HUMAN-RUN]");
      }
    }
  });

  it("AC-88: the C1 section starts with db:check-integrity --pre-c1 --snapshot, then tenant:register-shared --snapshot", () => {
    const c1Index = lines.findIndex((line) => line.startsWith("## C1"));
    const nextSectionIndex = lines.findIndex(
      (line, index) => index > c1Index && line.startsWith("## "),
    );
    const c1Steps = lines
      .slice(c1Index, nextSectionIndex)
      .filter((line) => STEP_LINE.test(line));
    const integrityIndex = c1Steps.findIndex((line) =>
      line.includes("db-check-integrity --pre-c1"),
    );
    const registerIndex = c1Steps.findIndex((line) =>
      line.includes("tenant:register-shared --snapshot"),
    );
    expect(integrityIndex).toBeGreaterThanOrEqual(0);
    expect(registerIndex).toBeGreaterThan(integrityIndex);
    // "starts with" (AC-88): only a local dry-run rehearsal may precede them.
    expect(integrityIndex).toBeLessThanOrEqual(1);
  });
});
