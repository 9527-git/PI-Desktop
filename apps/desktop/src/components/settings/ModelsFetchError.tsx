/**
 * The service probe's failure, as a banner or as the list's placeholder.
 *
 * The summary is the mapped code a user can recognize; the detail line carries
 * the transport or HTTP answer, which is what makes the error actionable.
 */
import { useTranslation } from "react-i18next";
import { describeModelsFetchError } from "./model-fetch-error";

export function ModelsFetchErrorMessage({
  error,
  variant,
}: {
  error?: string;
  variant: "banner" | "placeholder";
}) {
  const { t } = useTranslation();
  const view = describeModelsFetchError(error);
  let summary = t("settings.modelsFetchFailed");
  switch (view.kind) {
    case "unauthorized":
      summary = t("errors.PROVIDER_UNAUTHORIZED");
      break;
    case "notFound":
      summary = t("settings.modelsFetchNotFound");
      break;
    case "rateLimited":
      summary = t("errors.PROVIDER_RATE_LIMITED");
      break;
    case "timeout":
      summary = t("errors.TIMEOUT");
      break;
    case "network":
      summary = t("errors.NETWORK_ERROR");
      break;
    case "invalidResponse":
      summary = t("settings.modelsFetchInvalidResponse");
      break;
    case "http":
      summary = t("settings.modelsFetchFailedStatus", {
        status: view.summaryParams?.status ?? 0,
      });
      break;
  }
  const className =
    variant === "placeholder"
      ? "provider-models-placeholder is-error"
      : "provider-models-note is-error";
  return (
    <div className={className} role="alert">
      <span className="provider-models-error-summary">{summary}</span>
      {view.detail ? (
        <span className="provider-models-error-detail">{view.detail}</span>
      ) : null}
      {variant === "placeholder" ? (
        <span className="provider-models-error-hint">{t("settings.modelsFetchHint")}</span>
      ) : null}
    </div>
  );
}
