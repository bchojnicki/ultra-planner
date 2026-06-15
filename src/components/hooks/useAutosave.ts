import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Debounced, coalescing autosave. Each `schedule(payload)` replaces the pending
// payload (latest-wins) and (re)starts the debounce timer. Saves never overlap:
// while one is in flight, a newer payload queued via `schedule` is picked up by
// the loop as soon as the current save resolves. `status` drives a passive
// idle/saving/saved/error indicator — no dialogs, no blocking (US-08 "silent").
export function useAutosave<T>(saveFn: (payload: T) => Promise<void>, delay = 700) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(saveFn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A single non-null container ref: the nullable `pending` lives in a property
  // type, sidestepping React 19's `useRef<T | null>` overload (which collapses
  // `.current` to non-null and breaks the null checks below).
  const ctrl = useRef<{ pending: { payload: T } | null; saving: boolean }>({ pending: null, saving: false });

  // Keep the saver current without retriggering the callbacks below.
  useEffect(() => {
    saveRef.current = saveFn;
  });

  const run = useCallback(async () => {
    if (ctrl.current.saving) return;
    let next: { payload: T } | null = ctrl.current.pending;
    if (next === null) return;
    ctrl.current.saving = true;
    setStatus("saving");
    try {
      while (next !== null) {
        ctrl.current.pending = null;
        await saveRef.current(next.payload);
        next = ctrl.current.pending; // a change queued during the await
      }
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      ctrl.current.saving = false;
    }
  }, []);

  const schedule = useCallback(
    (payload: T) => {
      ctrl.current.pending = { payload };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void run();
      }, delay);
    },
    [delay, run],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { status, schedule };
}
