import { useTranslation } from "react-i18next";
import type { ReviewChange } from "@pi-desktop/shared";
import { cx } from "./ui";

/**
 * One change's diff content: the per-hunk lines, or the binary / truncated /
 * no-details notes that replace them. Shared by the review card's rollback
 * body and the per-turn summary, which render it without the actions.
 */
export function ReviewChangeDiffBody({ change }: { change: ReviewChange }) {
  const { t } = useTranslation();

  return (
    <>
      {change.binary ? (
        <div className="review-change-note">{t("panel.review.binary")}</div>
      ) : change.truncated ? (
        <div className="review-change-note">{t("panel.review.tooLarge")}</div>
      ) : change.hunks.length > 0 ? (
        <div className="review-change-diff">
          {change.hunks.map((hunk, hunkIndex) => (
            <div className="diff-hunk" key={`${hunk.header}-${hunkIndex}`}>
              <div className="diff-line hunk">
                <span className="diff-line-text">{hunk.header}</span>
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <div className={cx("diff-line", line.type)} key={lineIndex}>
                  <span className="diff-line-sign" aria-hidden>
                    {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                  </span>
                  <span className="diff-line-text">{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="review-change-note">
          {t("panel.review.noLineDetails")}
        </div>
      )}
    </>
  );
}
