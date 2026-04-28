import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  Session,
} from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { SessionIntent } from "../../../../src/modules/memory/domain/value-objects/session-intent.ts";
import { SessionMetadata } from "../../../../src/modules/memory/domain/value-objects/session-metadata.ts";
import { OpenQuestionText } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { SessionSummary } from "../../../../src/modules/memory/domain/value-objects/session-summary.ts";
import { SessionNextSeed } from "../../../../src/modules/memory/domain/value-objects/session-next-seed.ts";
import { TurnsCount } from "../../../../src/modules/memory/domain/value-objects/turns-count.ts";
import { SessionStarted } from "../../../../src/modules/memory/domain/events/session-started.ts";
import { SessionEnded } from "../../../../src/modules/memory/domain/events/session-ended.ts";
import { SessionOpenQuestionAdded } from "../../../../src/modules/memory/domain/events/session-open-question-added.ts";
import { SessionOpenQuestionResolved } from "../../../../src/modules/memory/domain/events/session-open-question-resolved.ts";
import { SessionAlreadyEndedError } from "../../../../src/modules/memory/domain/errors/session-already-ended-error.ts";
import { NonMonotonicActivityError } from "../../../../src/modules/memory/domain/errors/non-monotonic-activity-error.ts";
import { SessionIdleTimeoutExceededError } from "../../../../src/modules/memory/domain/errors/session-idle-timeout-exceeded-error.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_SESSION_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

function makeSession(overrides: {
  intent?: SessionIntent | null;
  resumedFrom?: SessionId | null;
  idleTimeoutMs?: number;
} = {}): Session {
  return Session.start({
    id: SessionId.from(FIXED_SESSION_UUID),
    workspaceId: makeWorkspaceId(),
    startedAt: makeTimestamp(),
    intent: overrides.intent ?? null,
    resumedFrom: overrides.resumedFrom ?? null,
    ...(overrides.idleTimeoutMs !== undefined
      ? { idleTimeoutMs: overrides.idleTimeoutMs }
      : {}),
  });
}

describe("Session (aggregate)", () => {
  describe("start", () => {
    it("creates a fresh open session with zero turns", () => {
      const s = makeSession();
      expect(s.isEnded()).toBe(false);
      expect(s.getTurnsCount().toNumber()).toBe(0);
      expect(s.getStartedAt().equals(s.getLastActivityAt())).toBe(true);
      expect(s.getIdleTimeoutMs()).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS);
      expect(s.getIntent()).toBe(null);
      expect(s.getResumedFrom()).toBe(null);
    });

    it("emits a SessionStarted event", () => {
      const s = makeSession();
      const events = s.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(SessionStarted);
    });

    it("accepts intent + resumedFrom", () => {
      const s = makeSession({
        intent: SessionIntent.from("Build login flow"),
        resumedFrom: SessionId.from(SECOND_SESSION_UUID),
      });
      expect(s.getIntent()?.toString()).toBe("Build login flow");
      expect(s.getResumedFrom()?.toString()).toBe(SECOND_SESSION_UUID);
    });

    it("accepts a custom idleTimeoutMs", () => {
      const s = makeSession({ idleTimeoutMs: 60_000 });
      expect(s.getIdleTimeoutMs()).toBe(60_000);
    });

    it("rejects non-positive idleTimeoutMs", () => {
      expect(() => makeSession({ idleTimeoutMs: 0 })).toThrow(InvalidInputError);
      expect(() => makeSession({ idleTimeoutMs: -1 })).toThrow(InvalidInputError);
    });

    it("rejects fractional idleTimeoutMs", () => {
      expect(() => makeSession({ idleTimeoutMs: 1.5 })).toThrow(
        InvalidInputError,
      );
    });

    it("rejects non-finite idleTimeoutMs", () => {
      expect(() =>
        makeSession({ idleTimeoutMs: Number.POSITIVE_INFINITY }),
      ).toThrow(InvalidInputError);
    });
  });

  describe("recordActivity", () => {
    it("bumps turnsCount and lastActivityAt", () => {
      const s = makeSession();
      s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 1000));
      expect(s.getTurnsCount().toNumber()).toBe(1);
      expect(s.getLastActivityAt().equals(makeTimestamp(ANCHOR_TIME_MS + 1000)))
        .toBe(true);
    });

    it("rejects activity older than lastActivityAt", () => {
      const s = makeSession();
      s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 1000));
      expect(() => s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 500))).toThrow(
        NonMonotonicActivityError,
      );
    });

    it("rejects activity past the idle timeout", () => {
      const s = makeSession({ idleTimeoutMs: 60_000 });
      expect(() =>
        s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 60_001)),
      ).toThrow(SessionIdleTimeoutExceededError);
    });

    it("rejects activity on a closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 200)),
      ).toThrow(SessionAlreadyEndedError);
    });
  });

  describe("addOpenQuestion / resolveOpenQuestion", () => {
    const text = OpenQuestionText.from("Should we use Argon2id?");

    it("adds an open question and emits an event", () => {
      const s = makeSession();
      s.pullEvents();
      s.addOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      const events = s.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(SessionOpenQuestionAdded);
      expect(s.getMetadata().hasOpenQuestion(text)).toBe(true);
    });

    it("addOpenQuestion is idempotent (no duplicate event)", () => {
      const s = makeSession();
      s.addOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      s.pullEvents();
      s.addOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
      });
      expect(s.pullEvents()).toHaveLength(0);
    });

    it("resolveOpenQuestion removes the question and emits an event", () => {
      const s = makeSession();
      s.addOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      s.pullEvents();
      s.resolveOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
      });
      const events = s.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(SessionOpenQuestionResolved);
      expect(s.getMetadata().hasOpenQuestion(text)).toBe(false);
    });

    it("resolveOpenQuestion is a no-op when not present", () => {
      const s = makeSession();
      s.pullEvents();
      s.resolveOpenQuestion({
        text,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(s.pullEvents()).toHaveLength(0);
    });

    it("addOpenQuestion refuses on a closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        s.addOpenQuestion({
          text,
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(SessionAlreadyEndedError);
    });

    it("resolveOpenQuestion refuses on a closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        s.resolveOpenQuestion({
          text,
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(SessionAlreadyEndedError);
    });
  });

  describe("setSummary / setNextSeed / setIntent", () => {
    it("setSummary stores the summary", () => {
      const s = makeSession();
      const summary = SessionSummary.from("Did the work");
      s.setSummary({
        summary,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(s.getSummary()?.toString()).toBe("Did the work");
    });

    it("setNextSeed stores the next seed", () => {
      const s = makeSession();
      const seed = SessionNextSeed.from("Continue with X");
      s.setNextSeed({
        nextSeed: seed,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(s.getNextSeed()?.toString()).toBe("Continue with X");
    });

    it("setIntent stores the intent", () => {
      const s = makeSession();
      s.setIntent({
        intent: SessionIntent.from("Add tests"),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(s.getIntent()?.toString()).toBe("Add tests");
    });

    it("setSummary/setNextSeed/setIntent refuse on a closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        s.setSummary({
          summary: SessionSummary.from("x"),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(SessionAlreadyEndedError);
      expect(() =>
        s.setNextSeed({
          nextSeed: SessionNextSeed.from("x"),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(SessionAlreadyEndedError);
      expect(() =>
        s.setIntent({
          intent: SessionIntent.from("x"),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(SessionAlreadyEndedError);
    });
  });

  describe("end", () => {
    it("closes the session and emits SessionEnded", () => {
      const s = makeSession();
      s.pullEvents();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1_000) });
      expect(s.isEnded()).toBe(true);
      const events = s.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(SessionEnded);
    });

    it("rejects ending an already-closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) }),
      ).toThrow(SessionAlreadyEndedError);
    });

    it("rejects ending with a timestamp older than lastActivityAt", () => {
      const s = makeSession();
      s.recordActivity(makeTimestamp(ANCHOR_TIME_MS + 1000));
      expect(() =>
        s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 500) }),
      ).toThrow(NonMonotonicActivityError);
    });
  });

  describe("isIdle", () => {
    it("returns true when more than idleTimeoutMs has elapsed", () => {
      const s = makeSession({ idleTimeoutMs: 60_000 });
      expect(s.isIdle(makeTimestamp(ANCHOR_TIME_MS + 60_001))).toBe(true);
    });

    it("returns false within the idle window", () => {
      const s = makeSession({ idleTimeoutMs: 60_000 });
      expect(s.isIdle(makeTimestamp(ANCHOR_TIME_MS + 30_000))).toBe(false);
    });

    it("returns false at the exact threshold", () => {
      const s = makeSession({ idleTimeoutMs: 60_000 });
      expect(s.isIdle(makeTimestamp(ANCHOR_TIME_MS + 60_000))).toBe(false);
    });

    it("returns true for a closed session", () => {
      const s = makeSession();
      s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(s.isIdle(makeTimestamp(ANCHOR_TIME_MS + 200))).toBe(true);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events and validates idleTimeoutMs", () => {
      const s = Session.rehydrate({
        id: SessionId.from(FIXED_SESSION_UUID),
        workspaceId: makeWorkspaceId(),
        startedAt: makeTimestamp(),
        endedAt: null,
        lastActivityAt: makeTimestamp(),
        idleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
        intent: null,
        summary: null,
        nextSeed: null,
        resumedFrom: null,
        turnsCount: TurnsCount.zero(),
        metadata: SessionMetadata.empty(),
      });
      expect(s.pullEvents()).toHaveLength(0);
    });

    it("rejects corrupt idleTimeoutMs", () => {
      expect(() =>
        Session.rehydrate({
          id: SessionId.from(FIXED_SESSION_UUID),
          workspaceId: makeWorkspaceId(),
          startedAt: makeTimestamp(),
          endedAt: null,
          lastActivityAt: makeTimestamp(),
          idleTimeoutMs: 0,
          intent: null,
          summary: null,
          nextSeed: null,
          resumedFrom: null,
          turnsCount: TurnsCount.zero(),
          metadata: SessionMetadata.empty(),
        }),
      ).toThrow(InvalidInputError);
    });
  });
});
