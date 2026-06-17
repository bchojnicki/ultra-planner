import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "@/types";

interface Props {
  plans: Plan[];
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// Dashboard plan list + delete (S-05). Seeded with the server-loaded plans; a
// per-row delete opens a confirmation modal, then DELETE /api/plans/:id and
// removes the row from local state on success (empty-state shows when the last
// plan goes). Mirrors the fetch-then-local-state delete pattern in GearProfileForm:
// the row is never removed optimistically — only on a confirmed 2xx.
export default function PlanList({ plans: initial }: Props) {
  const [plans, setPlans] = useState<Plan[]>(initial);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirming = plans.find((p) => p.id === confirmingId) ?? null;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (pending) return; // don't dismiss mid-request
    setConfirmingId(null);
    setError(null);
  }, [pending]);

  // a11y for the modal: focus the Cancel button on open, Escape to close, and
  // trap Tab focus within the dialog (cycle between Cancel/Delete) so keyboard
  // focus can't wander to the page behind the overlay.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (focusable.length === 0) {
        e.preventDefault(); // nothing focusable (e.g. mid-request) — keep focus in the dialog
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [confirming, close]);

  async function confirmDelete() {
    if (!confirmingId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${confirmingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      setPlans((prev) => prev.filter((p) => p.id !== confirmingId));
      setConfirmingId(null);
    } catch {
      setError("Couldn't delete the plan. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (plans.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/10 p-8 text-center backdrop-blur-xl">
        <p className="text-blue-100/80">You have no plans yet.</p>
        <p className="mt-1 text-sm text-blue-100/50">Click “New plan” to create your first race plan.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {plans.map((plan) => (
          <li
            key={plan.id}
            data-testid="plan-row"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-xl transition-colors hover:bg-white/20"
          >
            <a href={`/plans/${plan.id}`} className="flex flex-1 items-center justify-between gap-2">
              <span className="font-medium">{plan.name}</span>
              <span className="text-sm text-blue-100/50">Updated {fmtDate(plan.updated_at)}</span>
            </a>
            <button
              type="button"
              data-testid="plan-delete"
              aria-label={`Delete ${plan.name}`}
              onClick={() => {
                setError(null);
                setConfirmingId(plan.id);
              }}
              className="rounded-md border border-white/20 px-2 py-1 text-xs text-blue-100/70 transition-colors hover:bg-white/10"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-plan-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/60"
          />
          <div
            ref={dialogRef}
            className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/90 p-6 text-white backdrop-blur-xl"
          >
            <h2 id="delete-plan-title" className="text-lg font-semibold">
              Delete plan?
            </h2>
            <p className="mt-2 text-sm text-blue-100/70">Delete “{confirming.name}”? This can’t be undone.</p>
            {error ? (
              <p data-testid="plan-delete-error" className="mt-3 text-sm text-red-300">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                data-testid="plan-delete-cancel"
                disabled={pending}
                onClick={close}
                className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="plan-delete-confirm"
                disabled={pending}
                onClick={() => void confirmDelete()}
                className="rounded-lg border border-red-400/30 bg-red-600/80 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
