import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
// Node strips the types itself; the hook only supplies the `.ts` extension the
// bundler-style relative imports omit.
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { resolveLooseOpenablePath, revealTarget, statOpenablePath } = await import(
  "../electron/main/fs-open-gate.ts"
);

/** A fixture with a fake app-data directory and one real workspace child. */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-fs-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const dataDir = join(root, "appdata");
  const outside = join(root, "outside");
  await Promise.all([mkdir(workspace), mkdir(dataDir), mkdir(outside)]);
  await writeFile(join(workspace, "note.md"), "workspace\n");
  await writeFile(join(outside, "artifact.txt"), "artifact\n");
  await writeFile(join(dataDir, "pi.sqlite"), "db\n");
  return { root, workspace, dataDir, outside };
}

test("the OS handoff accepts an existing absolute path outside the workspace", async (t) => {
  const { outside, dataDir } = await fixture(t);
  const artifact = join(outside, "artifact.txt");
  const resolved = await resolveLooseOpenablePath(artifact, [dataDir]);
  assert.equal(resolved, await realpath(artifact));
});

test("the OS handoff refuses what it cannot hand to the OS", async (t) => {
  const { root, outside, dataDir } = await fixture(t);
  // Relative paths never qualify: only an absolute token can name a file the
  // transcript showed in full.
  assert.equal(await resolveLooseOpenablePath("artifact.txt", [dataDir]), null);
  assert.equal(await resolveLooseOpenablePath("./artifact.txt", [dataDir]), null);
  // Home-relative is not resolved by main.
  assert.equal(await resolveLooseOpenablePath("~/secret.ts", [dataDir]), null);
  assert.equal(await resolveLooseOpenablePath("", [dataDir]), null);
  // A target that is not there cannot be opened or located.
  assert.equal(await resolveLooseOpenablePath(join(outside, "gone.txt"), [dataDir]), null);
  assert.equal(await resolveLooseOpenablePath(root, []), await realpath(root));
});

test("protected roots are refused through their resolved target", async (t) => {
  const { dataDir } = await fixture(t);
  const db = join(dataDir, "pi.sqlite");
  assert.equal(await resolveLooseOpenablePath(db, [dataDir]), null);
  assert.equal(await resolveLooseOpenablePath(dataDir, [dataDir]), null);
  // Without the protected root named, the same path is an ordinary local file.
  assert.equal(await resolveLooseOpenablePath(db, []), await realpath(db));
});

test("the probe reports existence and kind only", async (t) => {
  const { workspace, outside, dataDir } = await fixture(t);
  const extra = [join(dataDir, "scratch")];
  await mkdir(extra[0]);

  const workspaceFile = await statOpenablePath("note.md", workspace, extra, [dataDir]);
  assert.deepEqual(workspaceFile, { exists: true, kind: "file" });

  const workspaceDir = await statOpenablePath(".", workspace, extra, [dataDir]);
  assert.deepEqual(workspaceDir, { exists: true, kind: "dir" });

  // An outside absolute path is probed through the same handoff gate.
  const artifact = await statOpenablePath(
    join(outside, "artifact.txt"),
    workspace,
    extra,
    [dataDir],
  );
  assert.deepEqual(artifact, { exists: true, kind: "file" });

  // The verdict carries no size and no directory listing.
  assert.deepEqual(Object.keys(artifact).sort(), ["exists", "kind"]);
});

test("the probe answers false for anything that could not open either", async (t) => {
  const { workspace, outside, dataDir } = await fixture(t);
  const extra = [join(dataDir, "scratch")];
  await mkdir(extra[0]);

  assert.deepEqual(await statOpenablePath("missing.md", workspace, extra, [dataDir]), {
    exists: false,
    kind: null,
  });
  assert.deepEqual(
    await statOpenablePath(join(outside, "gone.txt"), workspace, extra, [dataDir]),
    { exists: false, kind: null },
  );
  assert.deepEqual(
    await statOpenablePath(join(dataDir, "pi.sqlite"), workspace, extra, [dataDir]),
    { exists: false, kind: null },
  );
  assert.deepEqual(await statOpenablePath("note.md", null, extra, [dataDir]), {
    exists: false,
    kind: null,
  });
  assert.deepEqual(await statOpenablePath("", workspace, extra, [dataDir]), {
    exists: false,
    kind: null,
  });
});

test("reveal opens a directory, selects a file, and survives a vanished entry", async (t) => {
  const { workspace, outside } = await fixture(t);
  const calls = [];
  const shell = {
    async openPath(path) {
      calls.push(["openPath", path]);
      return "";
    },
    showItemInFolder(path) {
      calls.push(["showItemInFolder", path]);
    },
  };

  const file = join(outside, "artifact.txt");
  revealTarget(file, shell);
  assert.deepEqual(calls, [["showItemInFolder", file]]);


  calls.length = 0;
  revealTarget(workspace, shell);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "openPath");
  assert.equal(resolve(calls[0][1]), resolve(workspace));

  // The entry disappeared between the containment check and the reveal: show
  // the nearest directory that still exists instead of doing nothing.
  calls.length = 0;
  revealTarget(join(outside, "gone", "deeper.txt"), shell);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "openPath");
  assert.equal(resolve(calls[0][1]), resolve(outside));
});
