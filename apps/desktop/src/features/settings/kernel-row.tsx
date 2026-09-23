import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { Button } from "../../components/ui";
import { SettingsRow } from "./primitives";

type KernelCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version: string }
  | { status: "available"; version: string }
  | { status: "error"; message: string };

/**
 * Bundled PI kernel version plus one manual upstream check (D467). Kernel
 * updates ship inside PI-Desktop releases, so a newer upstream kernel points
 * at the kernel's own release page (D468) instead of downloading anything
 * here.
 */
export function KernelUpdateRow({ kernelVersion }: { kernelVersion?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<KernelCheckState>({ status: "idle" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = async () => {
    setState({ status: "checking" });
    try {
      const result = await api.kernelCheckUpdate();
      if (!alive.current) return;
      setState(
        result.updateAvailable
          ? { status: "available", version: result.latestVersion }
          : { status: "up-to-date", version: result.currentVersion },
      );
    } catch (error) {
      if (!alive.current) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const checking = state.status === "checking";
  let statusText: string | null = null;
  if (state.status === "checking") {
    statusText = t("kernel.checking");
  } else if (state.status === "up-to-date") {
    statusText = t("kernel.upToDate", { version: state.version });
  } else if (state.status === "available") {
    statusText = t("kernel.available", { version: state.version });
  } else if (state.status === "error") {
    statusText = t("kernel.error", { message: state.message });
  }

  return (
    <SettingsRow title={t("kernel.title")} description={t("kernel.desc")}>
      <div className="flex flex-col items-end gap-1.5">
        <div className="update-settings-actions">
          {kernelVersion ? (
            <span className="font-mono text-xs-plus text-text-muted">
              {kernelVersion}
            </span>
          ) : null}
          {state.status === "available" ? (
            <Button
              variant="secondary"
              onClick={() => void api.kernelOpenReleases().catch(() => undefined)}
            >
              {t("updates.viewRelease")}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking ? t("kernel.checking") : t("kernel.check")}
          </Button>
        </div>
        {statusText ? (
          <div className="text-right text-xs-plus text-text-muted">
            {statusText}
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}
