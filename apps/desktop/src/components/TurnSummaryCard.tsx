import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssistantTurnEntry } from "../lib/assistant-turns";
import { assistantTurnTools } from "../lib/assistant-turns";
import {
  turnFileChanges,
  turnFilesTotal,
  type TurnFileChange,
  type TurnFileStatus,
} from "../lib/turn-files";
import { fileWorkPanelTab, toolWorkPanelTab } from "../lib/work-panel-tabs";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { cx, TooltipButton } from "./ui";
import { IconChevronRight, IconDiff, IconExternal, IconFolder } from "./icons";
import { ReviewChangeDiffBody } from "./ReviewChangeDiff";

/* Git-status letters carry the category without relying on color alone. */
const STATUS_MARKS: Record<TurnFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

/** Added first, then modified, then deleted — the reader's natural order. */
const GROUP_ORDER: TurnFileStatus[] = ["added", "modified", "deleted"];

function TurnFileRow({ file }: { file: TurnFileChange }) {
  const { t } = useTranslation();
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const showToast = useAppStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const toggleLabel = t("chat.turnFilesHide", { path: file.path });
  const openLabel = t("chat.turnFilesOpenFile", { path: file.path });
  const revealLabel = t("chat.turnFilesReveal", { path: file.path });

  const reveal = () => {
    void api.fsReveal(file.path).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    });
  };

  return (
    <div className="turn-files-entry" data-status={file.status}>
      <div className="turn-files-row">
        <button
          type="button"
          className="turn-files-path"
          aria-expanded={open}
          aria-label={toggleLabel}
          title={file.path}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="turn-files-caret" aria-hidden>
            <IconChevronRight size={11} />
          </span>
          <span
            className={cx("turn-files-mark", `is-${file.status}`)}
            aria-hidden
          >
            {STATUS_MARKS[file.status]}
          </span>
          <span className="turn-files-name">{file.path}</span>
        </button>
        <span
          className="diff-counts turn-files-counts"
          aria-label={t("chat.reviewChangeCounts", file)}
        >
          {file.additions > 0 ? (
            <span className="diff-count-add">+{file.additions}</span>
          ) : null}
          {file.deletions > 0 ? (
            <span className="diff-count-del">−{file.deletions}</span>
          ) : null}
        </span>
        {file.status !== "deleted" ? (
          <TooltipButton
            className="copy-btn icon"
            tooltip={revealLabel}
            ariaLabel={revealLabel}
            onClick={reveal}
          >
            <IconFolder size={12} />
          </TooltipButton>
        ) : null}
        <TooltipButton
          className="copy-btn icon"
          tooltip={openLabel}
          ariaLabel={openLabel}
          onClick={() => openWorkPanelTab(fileWorkPanelTab(file.path))}
        >
          <IconExternal size={12} />
        </TooltipButton>
      </div>
      {open ? (
        <div className="turn-files-diffs">
          {file.records.map((record) => (
            <div
              className="turn-files-diff"
              key={record.change.snapshotId}
            >
              <ReviewChangeDiffBody change={record.change} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The per-turn completion summary: one compact card after a finished turn
 * lists what the turn did — steps taken and the workspace files it durably
 * changed, grouped by added/modified/deleted. The review tab keeps the
 * session-wide list; this is the local view inside the conversation. Each
 * file row expands its diffs, opens the file in the work panel, or reveals
 * it in the OS file manager.
 */
export function TurnSummaryCard({ entry }: { entry: AssistantTurnEntry }) {
  const { t } = useTranslation();
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const files = useMemo(() => turnFileChanges(entry), [entry]);
  const steps = assistantTurnTools(entry).length;

  // Nothing durable to report: a turn with no files and no steps would only
  // repeat the answer bubble above it.
  if (files.length === 0 && steps === 0) return null;
  const total = turnFilesTotal(files);
  const title = t("chat.turnSummaryTitle");

  return (
    <section
      className="turn-files-card"
      data-testid="turn-summary-card"
      aria-label={title}
    >
      <header className="turn-files-heading">
        <span className="turn-files-title">{title}</span>
        {steps > 0 ? (
          <span className="turn-files-steps">
            {t("chat.resultSteps", { count: steps })}
          </span>
        ) : null}
        <span className="diff-counts turn-files-counts">
          {total.additions > 0 ? (
            <span className="diff-count-add">+{total.additions}</span>
          ) : null}
          {total.deletions > 0 ? (
            <span className="diff-count-del">−{total.deletions}</span>
          ) : null}
        </span>
        {files.length > 0 ? (
          <TooltipButton
            className="copy-btn icon"
            tooltip={t("chat.turnFilesOpenReview")}
            ariaLabel={t("chat.turnFilesOpenReview")}
            onClick={() => openWorkPanelTab(toolWorkPanelTab("review"))}
          >
            <IconDiff size={12} />
          </TooltipButton>
        ) : null}
      </header>
      {GROUP_ORDER.map((status) => {
        const group = files.filter((file) => file.status === status);
        if (group.length === 0) return null;
        return (
          <div className="turn-files-group" key={status} data-status={status}>
            <span className="turn-files-group-label">
              {t(`panel.review.status.${status}`)}
              <span className="turn-files-group-count">{group.length}</span>
            </span>
            {group.map((file) => (
              <TurnFileRow key={file.path} file={file} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
