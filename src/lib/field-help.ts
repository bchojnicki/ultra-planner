// Central source of truth for on-hover field-help copy, mirroring the label-map
// pattern in gear-kinds.ts / aid-station-facilities.ts. Keys are stable
// identifiers grouped by the form surface they belong to; each value is a short,
// plain-language explanation of what the field means or drives. Wired into the
// forms via <HelpTooltip text={FIELD_HELP.someKey} label="…" />.

export const FIELD_HELP = {
  // Race setup (RaceSetupForm)
  total_distance:
    "The full race distance. A GPX import calibrates this from your route; aid-station distances must fall below it.",
  elevation_gain: "Total climbing across the whole course, in metres. Used to estimate moving time per segment.",
  elevation_loss: "Total descent across the whole course, in metres.",
  hourly_fluid: "Your target fluid intake per hour (ml). The plan spreads this across each segment by time.",
  hourly_carbs: "Your target carbohydrate intake per hour (g), spread across each segment by time.",
  hourly_sodium: "Your target sodium intake per hour (mg), spread across each segment by time.",
  start_time: "When you start the race. Sets the arrival clock times shown in the plan table.",
  expected_finish:
    "Your goal finish time (hours and minutes). Drives the pace used to estimate each segment's duration.",

  // Aid stations (AidStationManager — add form and inline edit panel)
  cumulative_distance:
    "Distance from the start to this aid station — not the segment length. Stations are ordered by this value.",
  cumulative_gain: "Total climbing from the start to this station, in metres.",
  cumulative_loss: "Total descent from the start to this station, in metres.",
  time_at_station: "Minutes you expect to spend stopped here. Added to your arrival times further along the course.",

  // Gear (GearProfileForm — kind selector + per-kind fueling fields)
  kind: "What kind of item this is. The type decides which fields apply and whether it counts toward fluid, carbs, or sodium.",
  carb_g: "Carbohydrate per unit or serving of this item, in grams.",
  sodium_mg: "Sodium per unit or serving of this item, in milligrams.",
  fluid_ml: "Liquid volume per serving, in millilitres (e.g. one mixed bottle).",
  capacity_ml: "How much liquid this carrier holds, in millilitres.",
  carb_ratio:
    "Relative weight for splitting carb intake across your carb sources when the plan auto-suggests units. Higher means this item is favoured.",

  // Plan table headers (PlanTable — computed output columns)
  col_time: "Estimated moving time for the segment — excludes time spent resting at aid stations.",
  col_arrival: "Clock time you reach the end of the segment, including any rest at stations along the way.",
  col_fuel: "The gear units to carry for this segment to hit its targets.",
  col_fluid: "Fluid your gear achieves vs the segment target (the delta is shown in parentheses).",
  col_carbs: "Carbs your gear achieves vs the segment target (the delta is shown in parentheses).",
  col_sodium: "Sodium your gear achieves vs the segment target (the delta is shown in parentheses).",
} as const;

export type FieldHelpKey = keyof typeof FIELD_HELP;
