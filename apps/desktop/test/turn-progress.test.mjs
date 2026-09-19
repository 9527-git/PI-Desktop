import assert from "node:assert/strict";
import test from "node:test";
import {
  TURN_PROGRESS_VISIBLE_STEPS,
  turnProgress,
} from "../src/lib/turn-progress.ts";

const AT = "2026-09-19T08:00:00.000Z";

function message(id, fields = {}) {
  return {
    id,
    role: "tool",
    content: "",
    createdAt: AT,
    ...fields,
  };
}

function toolStep(id, toolName, toolArgs, extra = {}) {
  return {
    kind: "tool",
    message: message(id, { toolName, toolArgs, ...extra }),
  };
}

function turn(fields = {}, ...parts) {
  return { kind: "assistant-turn", id: "turn-1", parts, ...fields };
}

function activityPart(...items) {
  return { kind: "activity", items };
}

function declaration(tasks) {
  return message("declare-1", {
    toolName: "UpdateTasks",
    toolArgs: { tasks },
    toolStatus: "success",
  });
}

/** The durable change record `workspace-review.ts` reads a Write/Edit row by. */
function reviewDetails(path, additions, deletions) {
  return {
    toolResult: {
      details: {
        root: "workspace",
        review: {
          version: 1,
          snapshotId: "snap-1",
          messageId: "edit-1",
          path,
          operation: "edit",
          status: "modified",
          state: "active",
          additions,
          deletions,
          hunks: [],
          reversible: true,
        },
      },
    },
  };
}

test("the card summarizes nothing before a turn exists", () => {
  assert.equal(turnProgress(null), null);

  const progress = turnProgress(turn(), Date.parse(AT));
  assert.equal(progress.steps, 0);
  assert.equal(progress.declared, false);
  assert.deepEqual(progress.visible, []);
  assert.equal(progress.earlierSteps, 0);
});

test("observed steps carry the status the tool row already reports", () => {
  const progress = turnProgress(
    turn(
      {},
      activityPart(
        { kind: "thinking", message: message("t0") },
        toolStep("a", "Read", { path: "src/a.ts" }, { toolStatus: "success" }),
      ),
      { kind: "message", message: message("m", { role: "assistant" }) },
      activityPart(
        toolStep("b", "Bash", { command: "pnpm build" }, { toolStatus: "error" }),
        toolStep("c", "Edit", { file_path: "src/c.ts" }),
      ),
    ),
    Date.parse(AT) + 61_000,
  );

  assert.equal(progress.declared, false);
  assert.equal(progress.steps, 3);
  assert.deepEqual(
    progress.visible.map((step) => [step.label, step.status]),
    [
      ["src/a.ts", "done"],
      ["pnpm build", "error"],
      ["src/c.ts", "active"],
    ],
  );
  assert.equal(progress.completed, 1);
  // The timer uses the turn's own first row, so it agrees with the inline group.
  assert.equal(progress.startedAt, Date.parse(AT));
  assert.equal(TURN_PROGRESS_VISIBLE_STEPS, 8);
});

test("a declared list replaces the observed rows and gives the card its denominator", () => {
  const progress = turnProgress(
    turn(
      { taskDeclarations: [declaration([
        { title: "读取 transcript 组件", status: "completed" },
        { title: "实现进度卡片", status: "in_progress" },
        { title: "补齐 8 个语言" },
        { title: "同步文档链", status: "pending" },
      ])] },
      activityPart(toolStep("a", "Read", { path: "src/a.ts" }, { toolStatus: "success" })),
    ),
    Date.parse(AT),
  );

  assert.equal(progress.declared, true);
  assert.equal(progress.steps, 4);
  assert.equal(progress.completed, 1);
  assert.deepEqual(
    progress.visible.map((step) => [step.label, step.status]),
    [
      ["读取 transcript 组件", "done"],
      ["实现进度卡片", "active"],
      ["补齐 8 个语言", "pending"],
      ["同步文档链", "pending"],
    ],
  );
  // The collapsed card names the step the turn is on, not the last row it ran.
  assert.equal(progress.activeLabel, "实现进度卡片");
});

test("the newest declaration is the live list, and a stray status still reads", () => {
  const progress = turnProgress(
    turn({
      taskDeclarations: [
        declaration([{ title: "stale plan", status: "in_progress" }]),
        declaration([
          { title: "finished first", status: "done" },
          { title: "second in flight", status: "In Progress" },
        ]),
      ],
    }),
    Date.parse(AT),
  );

  assert.equal(progress.steps, 2);
  assert.deepEqual(
    progress.visible.map((step) => step.label),
    ["finished first", "second in flight"],
  );
  assert.equal(progress.completed, 1);
});

test("a declaration the renderer cannot read falls back to the rows, not an empty card", () => {
  const progress = turnProgress(
    turn(
      { taskDeclarations: [declaration(undefined)] },
      activityPart(toolStep("a", "Read", { path: "src/a.ts" })),
    ),
    Date.parse(AT),
  );

  assert.equal(progress.declared, false);
  assert.equal(progress.steps, 1);
  assert.equal(progress.visible[0].label, "src/a.ts");
});

test("the footer counts this turn's recorded changes, not the workspace", () => {
  const progress = turnProgress(
    turn(
      {},
      activityPart(
        toolStep("edit-1", "Edit", { file_path: "src/a.ts" }, {
          toolStatus: "success",
          ...reviewDetails("src/a.ts", 900, 48),
        }),
        toolStep("edit-2", "Write", { file_path: "src/b.ts" }, {
          toolStatus: "success",
          ...reviewDetails("src/b.ts", 12, 0),
        }),
        toolStep("read-1", "Read", { path: "src/c.ts" }, { toolStatus: "success" }),
      ),
    ),
    Date.parse(AT),
  );

  assert.equal(progress.filesChanged, 2);
  assert.equal(progress.additions, 912);
  assert.equal(progress.deletions, 48);
});

test("a long turn folds older steps into one line instead of growing the card", () => {
  const progress = turnProgress(
    turn({
      taskDeclarations: [
        declaration(
          Array.from({ length: 20 }, (_value, index) => ({
            title: `src/step-${index}.ts`,
            status: index < 12 ? "completed" : "pending",
          })),
        ),
      ],
    }),
  );

  assert.equal(progress.steps, 20);
  assert.equal(progress.completed, 12);
  assert.equal(progress.visible.length, TURN_PROGRESS_VISIBLE_STEPS);
  assert.equal(progress.earlierSteps, 20 - TURN_PROGRESS_VISIBLE_STEPS);
  assert.equal(
    progress.visible.at(-1).label,
    "src/step-19.ts",
    "the newest step must stay on screen as the list grows",
  );
  assert.equal(
    progress.visible[0].label,
    "src/step-12.ts",
    "the window slides rather than the list growing",
  );
});

test("a turn without a parsable timestamp times from now, not from app launch", () => {
  const now = Date.parse(AT);
  const progress = turnProgress(
    turn(
      {},
      activityPart({
        kind: "tool",
        message: message("a", {
          toolName: "Read",
          toolArgs: { path: "src/a.ts" },
          createdAt: "",
        }),
      }),
    ),
    now,
  );

  assert.equal(progress.startedAt, now);
  assert.equal(progress.steps, 1);
});

test("an unsummarizable step keeps its slot with an empty label", () => {
  const progress = turnProgress(
    turn({}, activityPart(toolStep("a", "Read", undefined))),
  );

  assert.equal(progress.visible.length, 1);
  assert.equal(progress.visible[0].label, "");
  assert.equal(progress.visible[0].id, "a");
});
