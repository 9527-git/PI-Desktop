import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TooltipButton } from "./ui";
import { IconChevronRight, IconExternal, IconFolder } from "./icons";

/**
 * The summary tables share one shape — content, path, actions — so the reader
 * compares a change and an output the same way: what it is, where it lives,
 * what can be done with it.
 */
export function SummaryTable({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="turn-summary-section">
      <div className="turn-summary-section-title">
        {title}
        {count !== undefined ? (
          <span className="turn-summary-count">{count}</span>
        ) : null}
      </div>
      <table className="turn-summary-table">
        <thead>
          <tr>
            <th scope="col">{t("chat.summaryColumnContent")}</th>
            <th scope="col">{t("chat.summaryColumnPath")}</th>
            <th scope="col" className="turn-summary-actions-col">
              {t("chat.summaryColumnActions")}
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** +additions / −deletions, the compact diff summary a row carries. */
export function DiffCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const { t } = useTranslation();
  return (
    <span
      className="diff-counts"
      aria-label={t("chat.reviewChangeCounts", { additions, deletions })}
    >
      {additions > 0 ? <span className="diff-count-add">+{additions}</span> : null}
      {deletions > 0 ? <span className="diff-count-del">−{deletions}</span> : null}
    </span>
  );
}

/** The Chinese-marked note under a path whose file is no longer on disk. */
export function MissingHint() {
  const { t } = useTranslation();
  return <span className="turn-summary-missing">{t("chat.summaryMissingFile")}</span>;
}

/**
 * The per-row actions. A row whose file is gone disables them: open and reveal
 * would only fail, and the hint beside the path already says why.
 */
export function RowActions({
  path,
  missing,
  expandable = false,
  expanded = false,
  onToggle,
  onOpen,
  onReveal,
  canReveal = true,
}: {
  path: string;
  missing: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  onReveal: () => void;
  canReveal?: boolean;
}) {
  const { t } = useTranslation();
  const openLabel = t("chat.turnFilesOpenFile", { path });
  const revealLabel = t("chat.turnFilesReveal", { path });
  return (
    <div className="turn-summary-row-actions">
      {expandable ? (
        <TooltipButton
          type="button"
          className="copy-btn icon"
          tooltip={t(expanded ? "chat.turnFilesHide" : "chat.turnFilesShow", { path })}
          ariaLabel={t(expanded ? "chat.turnFilesHide" : "chat.turnFilesShow", {
            path,
          })}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <IconChevronRight size={12} />
        </TooltipButton>
      ) : null}
      {canReveal ? (
        <TooltipButton
          type="button"
          className="copy-btn icon"
          tooltip={revealLabel}
          ariaLabel={revealLabel}
          disabled={missing}
          onClick={onReveal}
        >
          <IconFolder size={12} />
        </TooltipButton>
      ) : null}
      <TooltipButton
        type="button"
        className="copy-btn icon"
        tooltip={openLabel}
        ariaLabel={openLabel}
        disabled={missing}
        onClick={onOpen}
      >
        <IconExternal size={12} />
      </TooltipButton>
    </div>
  );
}
