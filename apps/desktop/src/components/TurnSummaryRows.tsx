import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FsPathStat } from "@pi-desktop/shared";
import type { TurnArtifact } from "../lib/turn-artifacts";
import type { TurnFileChange, TurnFileStatus } from "../lib/turn-files";
import { fileWorkPanelTab } from "../lib/work-panel-tabs";
import { useAppStore } from "../stores/app-store";
import { useOpenPreviewTarget, useRevealLocalPath } from "../hooks/use-preview-target";
import { cx } from "./ui";
import { ReviewChangeDiffBody } from "./ReviewChangeDiff";
import { DiffCounts, MissingHint, RowActions } from "./TurnSummaryTable";

/* Git-status letters carry the category without relying on color alone. */
const STATUS_MARKS: Record<TurnFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

/** One changed file: what changed, where it lives, what can be done with it. */
export function ChangeRow({
  file,
  stat,
}: {
  file: TurnFileChange;
  stat?: FsPathStat;
}) {
  const { t } = useTranslation();
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const reveal = useRevealLocalPath();
  const [expanded, setExpanded] = useState(false);
  const missing = stat?.exists === false;
  const expandable = file.records.some(
    (record) =>
      record.change.hunks.length > 0 ||
      record.change.binary ||
      record.change.truncated,
  );

  return (
    <>
      <tr
        className="turn-summary-row"
        data-status={file.status}
        data-missing={missing ? "true" : undefined}
      >
        <td className="turn-summary-content">
          <span className={cx("turn-summary-mark", `is-${file.status}`)} aria-hidden>
            {STATUS_MARKS[file.status]}
          </span>
          <span className="turn-summary-op">{t(`chat.summaryOp.${file.status}`)}</span>
          <DiffCounts additions={file.additions} deletions={file.deletions} />
          {file.preview ? (
            <code className="turn-summary-preview" title={file.preview}>
              {file.preview}
            </code>
          ) : null}
        </td>
        <td className="turn-summary-path">
          <span className="turn-summary-path-text" title={file.path}>
            {file.path}
          </span>
          {missing ? <MissingHint /> : null}
        </td>
        <td className="turn-summary-actions">
          <RowActions
            path={file.path}
            missing={missing}
            expandable={expandable}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            onOpen={() => openWorkPanelTab(fileWorkPanelTab(file.path))}
            onReveal={() => reveal(file.path)}
            canReveal={file.status !== "deleted"}
          />
        </td>
      </tr>
      {expanded ? (
        <tr className="turn-summary-diff-row">
          <td colSpan={3}>
            {file.records.map((record) => (
              <div className="turn-summary-diff" key={record.change.snapshotId}>
                <ReviewChangeDiffBody change={record.change} />
              </div>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * One reported output. A workspace artifact opens in the work panel; a path
 * outside the workspace has no viewer, so the OS opens it (D424 / ADR 0256).
 */
export function ArtifactRow({
  artifact,
  stat,
}: {
  artifact: TurnArtifact;
  stat?: FsPathStat;
}) {
  const openTarget = useOpenPreviewTarget();
  const reveal = useRevealLocalPath();
  const missing = stat?.exists === false;

  return (
    <tr
      className="turn-summary-row"
      data-kind="artifact"
      data-missing={missing ? "true" : undefined}
    >
      <td className="turn-summary-content">
        <span className="turn-summary-note">{artifact.note}</span>
      </td>
      <td className="turn-summary-path">
        <span className="turn-summary-path-text" title={artifact.path}>
          {artifact.path}
        </span>
        {missing ? <MissingHint /> : null}
      </td>
      <td className="turn-summary-actions">
        <RowActions
          path={artifact.path}
          missing={missing}
          onOpen={() =>
            openTarget({
              kind: "file",
              path: artifact.path,
              ...(artifact.external ? { external: true as const } : {}),
            })
          }
          onReveal={() => reveal(artifact.path)}
        />
      </td>
    </tr>
  );
}
