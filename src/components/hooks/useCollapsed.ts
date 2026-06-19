import { useCallback, useSyncExternalStore } from "react";

// In-tab change fan-out: the `storage` event only fires in OTHER tabs, so a
// toggle in this tab notifies subscribers directly. Each subscriber re-reads its
// own key, so a shared emit is fine.
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function read(key: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

// Per-section collapsed state, persisted in localStorage and defaulting to
// expanded. SSR-safe via useSyncExternalStore: the server snapshot is always
// `false` (expanded) so the first client paint matches the server HTML, then
// React swaps in the client snapshot read from storage — no hydration mismatch
// and no set-state-in-effect. Storage access is guarded so it stays inert during
// SSR and resilient to disabled/throwing storage (private mode, quota).
export function useCollapsed(storageKey: string): [boolean, () => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey) onChange();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    [storageKey],
  );

  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => false,
  );

  const toggle = useCallback(() => {
    const next = !read(storageKey);
    try {
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(storageKey, "1");
        else window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Persistence is best-effort; ignore write failures.
    }
    emit();
  }, [storageKey]);

  return [collapsed, toggle];
}
