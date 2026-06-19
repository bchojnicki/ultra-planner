import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollapsed } from "@/components/hooks/useCollapsed";

interface Props {
  // Heading text shown in the disclosure header (rendered as the <h2>).
  title: string;
  // localStorage key owning this section's collapsed state. Scope it per plan
  // (e.g. `collapse:<plan-id>:race`) so two plans don't share collapse state.
  storageKey: string;
  // The section body, hidden when collapsed.
  children: ReactNode;
  // Optional content rendered beside the title, OUTSIDE the toggle button —
  // used for live header content like RaceSetupForm's save-status indicator,
  // which must not nest inside the button.
  headerExtra?: ReactNode;
  // Extra classes on the <section> (e.g. trailing-margin differences).
  className?: string;
}

// Shared shell + disclosure header for the collapsible plan-builder sections.
// The whole header row is the toggle button (large hit target, standard
// disclosure a11y via aria-expanded/aria-controls); the chevron rotates when
// collapsed. The wrapper owns the collapsed state so it survives child remounts
// (e.g. the GPX-import key bump on RaceSetupForm / AidStationManager).
export default function CollapsibleSection({ title, storageKey, children, headerExtra, className }: Props) {
  const [collapsed, toggle] = useCollapsed(storageKey);
  const bodyId = useId();

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl", className)}>
      <div className={cn("flex items-center justify-between", collapsed ? null : "mb-4")}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggle}
          className="-m-1 flex flex-1 items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-white/5 focus:ring-2 focus:ring-purple-400 focus:outline-none"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-5 shrink-0 transition-transform", collapsed && "-rotate-90")}
          />
          <h2 className="text-lg font-semibold">{title}</h2>
        </button>
        {headerExtra ? <div className="ml-3 shrink-0">{headerExtra}</div> : null}
      </div>
      <div id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
