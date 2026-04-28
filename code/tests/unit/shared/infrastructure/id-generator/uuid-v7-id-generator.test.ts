import { describe, it, expect } from "vitest";

import { UuidV7IdGenerator } from "../../../../../src/shared/infrastructure/id-generator/uuid-v7-id-generator.ts";
import { Id } from "../../../../../src/shared/domain/value-objects/id.ts";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UuidV7IdGenerator", () => {
  it("generateString returns a canonical lowercase UUID v7", () => {
    const gen = new UuidV7IdGenerator();
    const s = gen.generateString();
    expect(s).toMatch(UUID_V7_PATTERN);
  });

  it("generate returns an Id instance carrying that UUID", () => {
    const gen = new UuidV7IdGenerator();
    const id = gen.generate();
    expect(id).toBeInstanceOf(Id);
    expect(id.toString()).toMatch(UUID_V7_PATTERN);
  });

  it("yields distinct values across consecutive calls", () => {
    const gen = new UuidV7IdGenerator();
    const a = gen.generateString();
    const b = gen.generateString();
    const c = gen.generateString();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("produces UUIDs that round-trip through Id.create", () => {
    const gen = new UuidV7IdGenerator();
    const raw = gen.generateString();
    const id = Id.create(raw);
    expect(id.toString()).toBe(raw);
  });
});
