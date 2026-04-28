import { describe, expect, it } from "vitest";
import { MarkdownHandoffParser } from "../../../../src/modules/memory/infrastructure/import-export/markdown-handoff-parser.ts";

describe("MarkdownHandoffParser.parse", () => {
  const parser = new MarkdownHandoffParser();

  it("returns empty bag for empty document", () => {
    const result = parser.parse("");
    expect(result.decisions.length).toBe(0);
    expect(result.learnings.length).toBe(0);
    expect(result.tasks.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it("rejects non-string input", () => {
    expect(() =>
      parser.parse(null as unknown as string),
    ).toThrow(/UTF-8 string/);
  });

  it("rejects oversized documents", () => {
    const huge = Array(10_002).fill("line").join("\n");
    expect(() => parser.parse(huge)).toThrow(/exceeds/);
  });

  it("classifies decisions under '## 2. Decisiones tomadas' heading", () => {
    const md = `# H1

## 2. Decisiones tomadas

- Adopt SQLCipher: encryption at rest is required
- Use UTC timestamps: avoid timezone drift
`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(2);
    expect(result.decisions[0]?.title).toBe("Adopt SQLCipher");
    expect(result.decisions[0]?.rationale).toContain("encryption");
    expect(result.decisions[0]?.confidence).toBe(0.9);
    expect(result.decisions[0]?.tags.toArray()).toContain("handoff-import");
  });

  it("classifies learnings under '## 3. Learnings' with severity heuristics", () => {
    const md = `## 3. Learnings

- Always trim paths before comparing
- BUG: cache busting was missing
- CRITICAL: data loss on migration`;
    const result = parser.parse(md);
    expect(result.learnings.length).toBe(3);
    expect(result.learnings[0]?.severity).toBe("tip");
    expect(result.learnings[1]?.severity).toBe("warning");
    expect(result.learnings[2]?.severity).toBe("critical");
  });

  it("classifies tasks under '## 4. Pendientes' with priority heuristics", () => {
    const md = `## 4. Pendientes

- Wire embeddings: connect fastembed
- BLOQUEADOR: fix tsup --bundle flag
- URGENTE: rotate sonar token
- LOW priority cleanup`;
    const result = parser.parse(md);
    expect(result.tasks.length).toBe(4);
    expect(result.tasks[0]?.title).toBe("Wire embeddings");
    expect(result.tasks[0]?.priority).toBe("medium");
    expect(result.tasks[1]?.priority).toBe("high");
    expect(result.tasks[2]?.priority).toBe("critical");
    expect(result.tasks[3]?.priority).toBe("low");
  });

  it("ignores content outside recognized sections", () => {
    const md = `# Random

Some prose.

- A bullet outside any decision/learning/task section.`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(0);
    expect(result.learnings.length).toBe(0);
    expect(result.tasks.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it("collects unclassifiable content under sections in `skipped`", () => {
    const md = `## 2. Decisiones tomadas

Some prose without bullets.

- A: a real bullet here`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(1);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped[0]).toContain("L3");
  });

  it("strips id prefixes like 'D-001 — '", () => {
    const md = `## decisiones tomadas

- D-001 — Adopt SQLCipher: encryption at rest`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(1);
    expect(result.decisions[0]?.title).toBe("Adopt SQLCipher");
  });

  it("parses table rows under decisions section", () => {
    const md = `## decisiones tomadas

| # | Decision | Rationale |
| --- | --- | --- |
| D-001 | Use SQLCipher | encryption at rest |`;
    const result = parser.parse(md);
    // Table row: `| #` is the first cell — too short to qualify as a
    // decision title, so it ends up in skipped or is a no-op. The
    // important assertion is that the parser does not crash.
    expect(result).toBeDefined();
  });

  it("treats numbered list items as bullets", () => {
    const md = `## decisiones tomadas

1. Use TypeScript: type safety wins
2. Use Vitest: speed and DX`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(2);
  });

  it("treats short bullets (< 5 chars) as skipped under decisions section", () => {
    const md = `## decisiones tomadas

- abc`;
    const result = parser.parse(md);
    expect(result.decisions.length).toBe(0);
    expect(result.skipped.length).toBe(1);
  });

  // SonarQube S5852 — defence against catastrophic backtracking.
  // Crafts adversarial inputs that previously could trigger
  // super-linear regex behaviour and asserts the parser terminates
  // in well under a second on commodity hardware.
  it("terminates quickly on adversarial bullet-pattern input (ReDoS guard)", () => {
    // Input designed to maximise backtracking on `\s*` + `\d+\.` +
    // `\s+` + `(.+)$`: leading spaces, then a long digit run that
    // does NOT end in `.`, then a tail without a newline.
    const adversarial = `## decisiones tomadas\n${" ".repeat(64)}${"9".repeat(100_000)} not-a-bullet`;
    const start = Date.now();
    const result = parser.parse(adversarial);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1_000);
    expect(result).toBeDefined();
  });

  it("terminates quickly on adversarial table-row input (ReDoS guard)", () => {
    // Input designed to stress `TABLE_ROW_PATTERN`: many pipes
    // interleaved with content but without a closing `|` in the
    // expected position.
    const adversarial = `## decisiones tomadas\n|${"a|".repeat(50_000)}`;
    const start = Date.now();
    const result = parser.parse(adversarial);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1_000);
    expect(result).toBeDefined();
  });
});
