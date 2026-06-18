import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  // The help copy to show. Author it in src/lib/field-help.ts.
  text: string;
  // Names the field for the trigger's aria-label (e.g. "Carb ratio").
  label: string;
  className?: string;
}

// A small "?" help affordance placed after a field label. The trigger is its own
// focusable button (separate from the label→input association) so keyboard and
// touch users can reach the hint; Radix wires aria-describedby and handles
// hover / focus / escape / positioning. One provider per affordance keeps call
// sites trivial — each form is an independently hydrated island with no shared
// React root to host a single provider.
export default function HelpTooltip({ text, label, className }: Props) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Help: ${label}`}
            className={cn(
              "ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-white/30 text-[10px] leading-none text-blue-100/70 transition-colors hover:bg-white/10 focus:ring-2 focus:ring-purple-400 focus:outline-none",
              className,
            )}
          >
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
