import { describe, expect, it } from "vitest";
import {
  isTaskbarStatusKind,
  resolveTaskbarStatus,
  type TaskbarStatusSource,
} from "./taskbar-status.js";

function source(overrides: Partial<TaskbarStatusSource> = {}): TaskbarStatusSource {
  return {
    runningSessions: {},
    pendingPermissions: {},
    pendingAsks: {},
    pendingPlans: {},
    sessionOutcomes: {},
    ...overrides,
  };
}

describe("taskbar status aggregation", () => {
  it("reports nothing when no session is active or unread", () => {
    expect(resolveTaskbarStatus(source())).toEqual({ kind: "none", count: 0 });
  });

  it("reports running sessions and ignores false entries", () => {
    expect(
      resolveTaskbarStatus(
        source({
          runningSessions: { a: true, b: false, c: true },
        }),
      ),
    ).toEqual({ kind: "running", count: 2 });
  });

  it("puts any needs-input source above running work", () => {
    expect(
      resolveTaskbarStatus(
        source({
          runningSessions: { a: true, b: true },
          pendingPermissions: { a: [{}] },
        }),
      ),
    ).toEqual({ kind: "attention", count: 1 });
    expect(
      resolveTaskbarStatus(
        source({ pendingAsks: { a: [{}], b: [] } }),
      ),
    ).toEqual({ kind: "attention", count: 1 });
    expect(
      resolveTaskbarStatus(
        source({ pendingPlans: { a: { status: "pending" }, b: { status: "approved" } } }),
      ),
    ).toEqual({ kind: "attention", count: 1 });
  });

  it("counts a session once when it is both running and blocked", () => {
    expect(
      resolveTaskbarStatus(
        source({
          runningSessions: { a: true, b: true },
          pendingPermissions: { a: [{}] },
        }),
      ),
    ).toEqual({ kind: "attention", count: 1 });
  });

  it("falls through to unread terminal outcomes", () => {
    expect(
      resolveTaskbarStatus(
        source({
          sessionOutcomes: { a: "failed", b: "completed", c: undefined },
        }),
      ),
    ).toEqual({ kind: "failed", count: 1 });
    expect(
      resolveTaskbarStatus(source({ sessionOutcomes: { a: "completed", b: "completed" } })),
    ).toEqual({ kind: "completed", count: 2 });
  });

  it("validates the wire kinds", () => {
    expect(isTaskbarStatusKind("attention")).toBe(true);
    expect(isTaskbarStatusKind("none")).toBe(false);
    expect(isTaskbarStatusKind("busy")).toBe(false);
  });
});
