# Design Direction: Public pages — "Summit at first light"

> Output of the `frontend-design` skill (2026-06-19). Input to `/10x-plan public-pages-and-brand`.
> Scope: public/marketing pages only (welcome/landing, about, contact). The authenticated
> builder/dashboard is unchanged.

## Subject & job

Public face of an ultra-marathon race planner, for obsessive amateur ultra runners deciding
whether the tool gets their per-segment nutrition + pacing right. Welcome page's single job:
prove the wedge (time-on-feet, per-segment fueling) and get them in.

**Core insight:** the elevation profile *is* the mountain outline. A race's elevation
cross-section is the literal artifact the app works with — so the mountain motif is the data,
not clip-art.

## Tokens

### Color (night → dawn; cohesive with the app's dark glass)

| Token | Hex | Role |
| --- | --- | --- |
| `--summit-night` | `#0B1120` | base background (alpine pre-dawn; ties to app dark slate) |
| `--ridge` | `#151E2E` | raised glass panel surface (existing white/10 borders on top) |
| `--haze` | `#9FB0CC` | muted cool body text (cooler sibling of app's blue-100) |
| `--snowcap` | `#EEF4FF` | high-contrast headings |
| `--alpenglow` | `#FF8A5B` | warm signature accent — first light on the summit; used sparingly |
| `--trail-violet` | `#A78BFA` | interactive / links / focus (app's purple-400 family — cohesion thread) |

Deliberate risk: a **warm + cool two-accent tension** (alpenglow vs trail-violet) = the
night→dawn arc of an ultra. Warm carries the one emotional moment (the sunrise signature);
violet stays for all interaction so public ↔ app feel related. CTAs use violet, not the warm.

### Type

- **Display — Space Grotesk** (700/500): technical-grotesque, set big and tight, used sparingly.
- **Body — Inter** (400/500): quiet workhorse.
- **Data / eyebrows — Space Mono** (uppercase): distances, elevations, splits; reads like a
  GPS-watch / topo readout. Shares the "Space" lineage with the display face.

All three are Google Fonts (self-host or `@fontsource`); none currently loaded — the app uses
system/Tailwind defaults today, so this is additive to the public pages only.

### Layout & signature

- **Signature element:** the course-profile ridgeline. The hero draws a real elevation
  cross-section (SVG path); aid-station dots sit on it, each annotated with the exact
  per-segment carbs/fluid the app computes — the first thing a visitor sees is the product's
  actual output, on the mountain outline itself. The same ridgeline returns as a thin 1px
  divider between sections (one motif, carried through; everything else quiet).
- **Hero is NOT the big-number template** — it's a data-driven ridgeline that demonstrates the
  wedge. Headline sits in the "sky" above the ridge; one violet CTA below.
- **Structure device:** cumulative-distance mono eyebrows (`KM 0`, `KM 42`, `FINISH`) anchor
  sections only where content maps to a course. "How it works" is a genuine 3-step sequence →
  numbered steps are honest there, not decorative.
- **Motion (restrained):** on load, the ridgeline draws left-to-right and the alpenglow sun
  rises behind the peak — one orchestrated moment. `prefers-reduced-motion` → final state only.
  Nothing else animates.

### Hero wireframe

```
ULTRA PLANNER                          [ Sign in ]
   Fuel every climb,                  · ·  ☀ (alpenglow behind peak)
   not every kilometre.
      ┌ km 42 ┐                              ┌ km 71 ┐
      │+38g·500ml│  ╱╲    ╱╲╱╲╱▲(summit)╲____│+52g·750ml│
   ___╱  ╲__╱╲__╱  ╲__╱                  ╲________
   km0                                          fin
   [ Plan your race ]
```

## Pages in scope (for /10x-plan to structure)

- **Welcome / landing** (`/`, replaces stock `Welcome.astro`): hero ridgeline + wedge proof +
  3-step "how it works" + CTA to sign in. Also: post-login redirect → `/dashboard` (currently `/`).
- **About**: the wedge story (per-segment, time-on-feet nutrition) — why flat per-km fueling is
  wrong. Public, no auth.
- **Contact**: how to reach the maker. Public, no auth. (Form vs. mailto is a /10x-plan decision.)

## Cohesion contract with the app

Reuse the app's existing dark-glass vocabulary (`white/10` borders, `backdrop-blur`,
`purple-400`/trail-violet focus rings, rounded-2xl panels) so the public pages read as the same
product — the public layer adds the ridgeline signature, the dawn warm accent, and the
Space Grotesk/Space Mono type, which the authenticated app does not use.

## Quality floor

Responsive to mobile (ridgeline scales/simplifies), visible keyboard focus (violet ring),
`prefers-reduced-motion` respected, semantic public `<Layout>` distinct from the app shell.
