import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AssistantTurnEntry } from "../lib/assistant-turns";
import { assistantTurnTools } from "../lib/assistant-turns";
import { turnFileChanges, turnFilesTotal } from "../lib/turn-files";
import { turnArtifacts } from "../lib/turn-artifacts";
import { toolWorkPanelTab } from "../lib/work-panel-tabs";
import { useAppStore } from "../stores/app-store";
import { usePathExistence } from "../hooks/use-path-existence";
import { TooltipButton } from "./ui";
import { IconDiff } from "./icons";
import { SummaryTable } from "./TurnSummaryTable";
import { ArtifactRow, ChangeRow } from "./TurnSummaryRows";

/**
 * The per-turn completion summary: two tables after a finished turn.
 *
 * "Changes" lists the workspace files the turn durably wrote — what changed,
 * where, and what can be done with the file — from the message-owned review
 * evidence, so it reports exactly what the review tab records. "Outputs" lists
 * the files the turn's final answer reported as produced, which covers
 * artifacts no Write/Edit record can see (an installer, a build output).
 *
 * Either table marks a row whose file is no longer on disk and disables its
 * actions, so a stale path reads as stale instead of as a dead button.
 */
export function TurnSummaryCard({ entry }: { entry: AssistantTurnEntry }) {
  const { t } = useTranslation();
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const workspacePath = useAppStore((state) => state.workspace?.path ?? null);
  const files = useMemo(() => turnFileChanges(entry), [entry]);
  const artifacts = useMemo(
    () => turnArtifacts(entry, workspacePath, files.map((file) => file.path)),
    [entry, files, workspacePath],
  );
  const steps = assistantTurnTools(entry).length;
  const existence = usePathExistence([
    ...files.map((file) => file.path),
    ...artifacts.map((artifact) => artifact.path),
  ]);

  // Nothing to report: an empty card would only repeat the answer above it.
  if (files.length === 0 && artifacts.length === 0 && steps === 0) return null;
  const total = turnFilesTotal(files);
  const title = t("chat.turnSummaryTitle");

  return (
    <section
      className="turn-summary-card"
      data-testid="turn-summary-card"
      aria-label={title}
    >
      <header className="turn-summary-heading">
        <span className="turn-summary-title">{title}</span>
        {steps > 0 ? (
          <span className="turn-summary-steps">
            {t("chat.resultSteps", { count: steps })}
          </span>
        ) : null}
        <span className="diff-counts turn-summary-counts">
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
      {files.length > 0 ? (
        <SummaryTable title={t("chat.summaryChangesTitle")} count={files.length}>
          {files.map((file) => (
            <ChangeRow key={file.path} file={file} stat={existence[file.path]} />
          ))}
        </SummaryTable>
      ) : (
        <p className="turn-summary-empty">{t("chat.summaryNoChanges")}</p>
      )}
      {artifacts.length > 0 ? (
        <SummaryTable title={t("chat.summaryArtifactsTitle")} count={artifacts.length}>
          {artifacts.map((artifact) => (
            <ArtifactRow
              key={artifact.path}
              artifact={artifact}
              stat={existence[artifact.path]}
            />
          ))}
        </SummaryTable>
      ) : null}
    </section>
  );
}
