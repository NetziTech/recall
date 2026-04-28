/**
 * Lightweight factory helpers for memory/retrieval/curator tests.
 *
 * These build canonical-shape value objects with sensible defaults so
 * individual tests stay focused on the invariant they exercise instead
 * of restating boilerplate. Every helper accepts an optional override
 * bag so tests can pin only the fields they care about.
 */
import { WorkspaceId } from "../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../src/shared/domain/value-objects/timestamp.ts";
import { Confidence } from "../../src/shared/domain/value-objects/confidence.ts";
import { Tags } from "../../src/shared/domain/value-objects/tags.ts";

export const FIXED_WORKSPACE_UUID = "01952f3b-7d8c-7000-8000-aaaaaaaaaaaa";
export const FIXED_DECISION_UUID = "01952f3b-7d8c-7000-8000-bbbbbbbbbbbb";
export const FIXED_LEARNING_UUID = "01952f3b-7d8c-7000-8000-cccccccccccc";
export const FIXED_ENTITY_UUID = "01952f3b-7d8c-7000-8000-dddddddddddd";
export const FIXED_TASK_UUID = "01952f3b-7d8c-7000-8000-eeeeeeeeeeee";
export const FIXED_TURN_UUID = "01952f3b-7d8c-7000-8000-ffffffffffff";
export const FIXED_SESSION_UUID = "01952f3c-2222-7000-8000-111111111111";
export const FIXED_RELATION_UUID = "01952f3c-2222-7000-8000-222222222222";
export const FIXED_CURATOR_RUN_UUID = "01952f3c-2222-7000-8000-333333333333";
export const FIXED_BUNDLE_UUID = "01952f3c-2222-7000-8000-444444444444";

export const ANCHOR_TIME_MS = 1_700_000_000_000;

export function makeWorkspaceId(raw = FIXED_WORKSPACE_UUID): WorkspaceId {
  return WorkspaceId.from(raw);
}

export function makeTimestamp(epochMs: number = ANCHOR_TIME_MS): Timestamp {
  return Timestamp.fromEpochMs(epochMs);
}

export function makeConfidence(value: number = 1): Confidence {
  return Confidence.of(value);
}

export function makeTags(values: readonly string[] = []): Tags {
  return Tags.create(values);
}
