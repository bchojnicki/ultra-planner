import type { AidStation } from "@/types";

// The six aid-station facility flags, paired with their display labels.
// Shared by the station manager (checkboxes) and the plan table (badges).
export const AID_STATION_FLAGS = [
  ["water_only", "Water only"],
  ["food_available", "Food"],
  ["warm_meal", "Warm meal"],
  ["drop_bag_available", "Drop bag"],
  ["rest_area", "Rest area"],
  ["support_crew_allowed", "Crew"],
] as const;

export type AidStationFlagKey = (typeof AID_STATION_FLAGS)[number][0];

// Labels of the facilities enabled on a station, in flag order.
export function enabledFacilities(s: AidStation): string[] {
  return AID_STATION_FLAGS.filter(([key]) => s[key]).map(([, label]) => label);
}
