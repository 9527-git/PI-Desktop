import { describe, expect, it } from "vitest";
import {
  buildUpdateTasksTool,
  MAX_UPDATE_TASKS_ITEMS,
  normalizeTaskList,
} from "./task-list.js";

describe("UpdateTasks argument normalization", () => {
  it("keeps the declared order and the statuses the tool documents", () => {
    expect(
      normalizeTaskList([
        { title: "Read the failing test", status: "completed" },
        { title: "Fix the parser", status: "in_progress" },
        { title: "Rerun the suite" },
      ]),
    ).toEqual([
      { title: "Read the failing test", status: "completed" },
      { title: "Fix the parser", status: "in_progress" },
      { title: "Rerun the suite", status: "pending" },
    ]);
  });

  it("reads the status a model meant, not the status it typed", () => {
    expect(
      normalizeTaskList([
        { title: "a", status: "Done" },
        { title: "b", status: "in progress" },
        { title: "c", status: "working" },
        { title: "d", status: "" },
      ]),
    ).toEqual([
      { title: "a", status: "completed" },
      { title: "b", status: "in_progress" },
      { title: "c", status: "pending" },
      { title: "d", status: "pending" },
    ]);
  });

  it("drops the rows the card cannot show", () => {
    expect(
      normalizeTaskList([
        { title: "   " },
        { content: "Carried by the alternate field" },
        null,
        "A bare string still names a step",
      ]),
    ).toEqual([
      { title: "Carried by the alternate field", status: "pending" },
      { title: "A bare string still names a step", status: "pending" },
    ]);
  });

  it("bounds the list the card has to render", () => {
    const items = normalizeTaskList(
      Array.from({ length: MAX_UPDATE_TASKS_ITEMS + 10 }, (_value, index) => ({
        title: `step ${index}`,
      })),
    );
    expect(items).toHaveLength(MAX_UPDATE_TASKS_ITEMS);
  });

  it("reports a call it cannot read instead of declaring an empty task", () => {
    expect(normalizeTaskList(undefined)).toBeNull();
    expect(normalizeTaskList([])).toBeNull();
    expect(normalizeTaskList({ title: "not an array" })).toBeNull();
  });
});

describe("UpdateTasks tool result", () => {
  it("echoes the list with the counts the card shows", async () => {
    const tool = buildUpdateTasksTool();
    const result = await tool.execute("call-1", {
      tasks: [
        { title: "Read the failing test", status: "completed" },
        { title: "Fix the parser", status: "in_progress" },
      ],
    });
    // `isError` is the kernel's tool-failure flag, which the renderer sees as
    // `toolStatus: "error"`; the result type does not declare it.
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(result.details).toEqual({
      tasks: [
        { title: "Read the failing test", status: "completed" },
        { title: "Fix the parser", status: "in_progress" },
      ],
    });
    expect(JSON.stringify(result.content)).toContain("1 of 2 steps completed");
  });

  it("fails as a recoverable argument error, not as a host failure", async () => {
    const tool = buildUpdateTasksTool();
    const result = await tool.execute("call-1", { tasks: [] });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.details).toEqual({
      errorCode: "UPDATETASKS_INVALID_ARGUMENT",
    });
  });
});
