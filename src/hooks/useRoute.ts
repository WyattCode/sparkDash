import { useEffect, useCallback, useState } from "react";
import { OVERVIEW_ID } from "../constants";

export type RouteMode = "app" | "showcase";

export function activeIdFromPath(path: string = "/"): string {
  const match = path.match(/^\/spark\/([^/]+)/);
  if (!match) return OVERVIEW_ID;
  try { return decodeURIComponent(match[1]); } catch { return OVERVIEW_ID; }
}

export interface AppRoute {
  mode: RouteMode;
  /** Spark id for showcase mode */
  showcaseSparkId: string | null;
}

export function parsePath(pathname: string): AppRoute {
  const showcase = pathname.match(/^\/showcase\/([^/]+)/);
  if (showcase) {
    try {
      return { mode: "showcase", showcaseSparkId: decodeURIComponent(showcase[1]) };
    } catch { return { mode: "app", showcaseSparkId: null }; }
  }
  return { mode: "app", showcaseSparkId: null };
}

/**
 * Parse the current URL for showcase vs normal app shell.
 * Call once at App root so showcase skips the dashboard chrome.
 */
export function useAppRoute(): AppRoute {
  const [route, setRoute] = useState(() => parsePath(window.location.pathname));

  useEffect(() => {
    const handler = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return route;
}

/**
 * useRoute — syncs the browser URL path with the active spark ID.
 *
 * URL scheme:
 *   /             → Overview
 *   /spark/:id    → Spark detail page
 *   /showcase/:id → full-screen showcase (handled separately via useAppRoute)
 *
 * Call `navigate(id)` to switch views — it updates both the URL and
 * the internal activeId state. Back/forward buttons work via popstate.
 */
export function useRoute(
  setActiveId: (id: string | null) => void
): (id: string | null) => void {
  // Sync back/forward navigation
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname;
      if (path.startsWith("/showcase/")) return;
      setActiveId(activeIdFromPath(path));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [setActiveId]);

  // Wrapped navigate function — updates URL + internal state
  const navigate = useCallback(
    (id: string | null) => {
      const url = id && id !== OVERVIEW_ID ? `/spark/${encodeURIComponent(id)}` : "/";
      if (window.location.pathname !== url || window.location.search || window.location.hash) window.history.pushState(null, "", url);
      setActiveId(id ?? OVERVIEW_ID);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    },
    [setActiveId]
  );

  return navigate;
}
