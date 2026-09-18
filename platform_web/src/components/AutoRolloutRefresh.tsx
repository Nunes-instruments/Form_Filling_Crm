"use client";

import { useEffect } from "react";
import { NUNES_ROLLOUT_ID } from "@/lib/rollout-id";

export default function AutoRolloutRefresh() {
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const schedule = (delay = 5000) => {
      if (!stopped) timer = window.setTimeout(checkForUpdate, delay);
    };

    const checkForUpdate = async () => {
      try {
        const response = await fetch(`/api/health?_rollout=${Date.now()}`, {
          cache: "no-store",
          headers: { "x-nunes-client": "auto-rollout" },
        });
        if (response.ok) {
          const health = await response.json();
          const latest = String(health?.update_id || "").trim();
          if (latest && latest !== NUNES_ROLLOUT_ID) {
            const url = new URL(window.location.href);
            url.searchParams.set("_nunes_update", latest);
            url.searchParams.set("_nunes_reload", String(Date.now()));
            window.location.replace(url.toString());
            return;
          }
        }
      } catch {
        // During a main-server restart the old page can briefly lose connection.
        // Keep checking until the updated server is available again.
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer !== undefined) window.clearTimeout(timer);
        schedule(600);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule(1800);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
