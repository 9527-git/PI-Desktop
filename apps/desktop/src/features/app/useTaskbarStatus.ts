import { useEffect } from "react";
import { resolveTaskbarStatus, type TaskbarStatusSnapshot } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

function snapshotOf(state: ReturnType<typeof useAppStore.getState>): TaskbarStatusSnapshot {
  return resolveTaskbarStatus({
    runningSessions: state.runningSessions,
    pendingPermissions: state.pendingPermissions,
    pendingAsks: state.pendingAsks,
    pendingPlans: state.pendingPlans,
    sessionOutcomes: state.sessionOutcomes,
  });
}

/**
 * Mirror the aggregate session status onto the native taskbar/Dock badge
 * (D473). The renderer owns the live state; Main only paints. A repeated
 * snapshot is not sent again, so the IPC hop happens on real transitions.
 */
export function useTaskbarStatus() {
  useEffect(() => {
    let lastSignature = "";
    const push = (state: ReturnType<typeof useAppStore.getState>) => {
      const snapshot = snapshotOf(state);
      const signature = `${snapshot.kind}:${snapshot.count}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      void api.setTaskbarStatus(snapshot).catch(() => undefined);
    };
    push(useAppStore.getState());
    return useAppStore.subscribe((state, previous) => {
      if (
        state.runningSessions === previous.runningSessions &&
        state.pendingPermissions === previous.pendingPermissions &&
        state.pendingAsks === previous.pendingAsks &&
        state.pendingPlans === previous.pendingPlans &&
        state.sessionOutcomes === previous.sessionOutcomes
      ) {
        return;
      }
      push(state);
    });
  }, []);
}
