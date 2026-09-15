import { useEffect, useState } from "react";
import type { FsPathStat } from "@pi-desktop/shared";
import { api } from "../lib/api";

/** Verdicts by path; a path is absent until its probe answers. */
export type PathExistence = Record<string, FsPathStat | undefined>;

/** Cap on probes per batch: a summary never renders more rows than this. */
const MAX_PROBES = 48;

/**
 * Probe whether each path still exists, batched once per path set.
 *
 * The card marks a row whose file is gone, and open/reveal on that row would
 * only fail, so the answer has to come from the host (the renderer has no
 * filesystem). Failures resolve to "missing": an unreachable probe is not
 * evidence that a file exists.
 *
 * Late answers are dropped when the path set changes or the card unmounts —
 * transcript rows re-render often, and a stale verdict must not repaint a row
 * that now refers to something else.
 */
export function usePathExistence(paths: readonly string[]): PathExistence {
  const [state, setState] = useState<PathExistence>({});
  const unique = [...new Set(paths.filter(Boolean))].slice(0, MAX_PROBES);
  const key = unique.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) {
      setState({});
      return;
    }
    let alive = true;
    void (async () => {
      const verdicts: PathExistence = {};
      await Promise.all(
        list.map(async (path) => {
          try {
            verdicts[path] = await api.fsStat(path);
          } catch {
            verdicts[path] = { exists: false, kind: null };
          }
        }),
      );
      if (alive) setState(verdicts);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}
