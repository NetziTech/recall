import { describe, it, expect } from "vitest";

import { Tags } from "../../../../../src/shared/domain/value-objects/tags.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("Tags", () => {
  it("empty() yields zero size and isEmpty=true", () => {
    const t = Tags.empty();
    expect(t.size()).toBe(0);
    expect(t.isEmpty()).toBe(true);
    expect(t.toArray()).toEqual([]);
  });

  describe("create", () => {
    it("accepts an array of trimmed unique strings", () => {
      const t = Tags.create([" foo", "bar ", "baz"]);
      expect(t.toArray()).toEqual(["foo", "bar", "baz"]);
      expect(t.size()).toBe(3);
      expect(t.isEmpty()).toBe(false);
    });

    it("rejects non-string entries", () => {
      expect(() => Tags.create([123 as unknown as string])).toThrow(
        InvalidInputError,
      );
    });

    it("rejects whitespace-only entries", () => {
      expect(() => Tags.create(["   "])).toThrow(InvalidInputError);
      expect(() => Tags.create([""])).toThrow(InvalidInputError);
    });

    it("rejects duplicates after trimming", () => {
      expect(() => Tags.create(["foo", "foo "])).toThrow(InvalidInputError);
    });

    it("array is frozen", () => {
      const t = Tags.create(["foo"]);
      const arr = t.toArray();
      expect(Object.isFrozen(arr)).toBe(true);
    });
  });

  describe("contains", () => {
    it("matches trimmed lookups", () => {
      const t = Tags.create(["foo", "bar"]);
      expect(t.contains("foo")).toBe(true);
      expect(t.contains(" foo ")).toBe(true);
      expect(t.contains("zzz")).toBe(false);
    });
  });

  describe("add / remove", () => {
    it("add returns a new Tags", () => {
      const t = Tags.create(["foo"]);
      const t2 = t.add("bar");
      expect(t.toArray()).toEqual(["foo"]);
      expect(t2.toArray()).toEqual(["foo", "bar"]);
    });

    it("add rejects an already-present tag", () => {
      const t = Tags.create(["foo"]);
      expect(() => t.add("foo")).toThrow(InvalidInputError);
    });

    it("remove returns a new Tags without the entry", () => {
      const t = Tags.create(["foo", "bar"]);
      const t2 = t.remove("foo");
      expect(t2.toArray()).toEqual(["bar"]);
    });

    it("remove of non-existent tag returns equivalent Tags", () => {
      const t = Tags.create(["foo"]);
      const t2 = t.remove("missing");
      expect(t2.toArray()).toEqual(["foo"]);
      expect(t.equals(t2)).toBe(true);
    });
  });

  describe("equals", () => {
    it("self-equal", () => {
      const t = Tags.create(["foo"]);
      expect(t.equals(t)).toBe(true);
    });

    it("same content same order", () => {
      expect(Tags.create(["a", "b"]).equals(Tags.create(["a", "b"]))).toBe(true);
    });

    it("different order is not equal (order matters)", () => {
      expect(Tags.create(["a", "b"]).equals(Tags.create(["b", "a"]))).toBe(false);
    });

    it("different sizes are not equal", () => {
      expect(Tags.create(["a"]).equals(Tags.create(["a", "b"]))).toBe(false);
    });
  });

  describe("includesAll / intersectsNoneOf", () => {
    it("includesAll: true when subset", () => {
      const haystack = Tags.create(["a", "b", "c"]);
      const required = Tags.create(["a", "c"]);
      expect(haystack.includesAll(required)).toBe(true);
    });

    it("includesAll: false when missing", () => {
      const haystack = Tags.create(["a", "b"]);
      const required = Tags.create(["a", "z"]);
      expect(haystack.includesAll(required)).toBe(false);
    });

    it("intersectsNoneOf: true when disjoint", () => {
      const haystack = Tags.create(["a", "b"]);
      const forbidden = Tags.create(["x", "y"]);
      expect(haystack.intersectsNoneOf(forbidden)).toBe(true);
    });

    it("intersectsNoneOf: false when overlap", () => {
      const haystack = Tags.create(["a", "b"]);
      const forbidden = Tags.create(["x", "a"]);
      expect(haystack.intersectsNoneOf(forbidden)).toBe(false);
    });
  });
});
