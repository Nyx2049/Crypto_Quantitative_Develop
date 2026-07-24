# Candidate Card Design QA

- Source visual truth: `/var/folders/6q/j4xd86z97sq188g1wd78qfbw0000gn/T/codex-clipboard-d80ccdc4-a83a-4d63-9344-832663861c7c.png`
- Implementation screenshots:
  - Desktop: `/private/tmp/zeroslope-ui-after.png`
  - Mobile: `/private/tmp/zeroslope-ui-plain-background.png`
- Combined comparison: `/private/tmp/zeroslope-ui-plain-comparison.png`
- Source dimensions: `944 × 2048`
- Desktop viewport and capture: `1280 × 720`, device scale factor 1
- Mobile viewport and capture: `390 × 844`, device scale factor 1
- State: loaded candidate list with live Binance data

## Full-view comparison

The revised desktop candidate row uses a stable three-column grid. Symbol, trend
details, and action begin on the same baseline. The daily background is rendered
as plain secondary text without a border, background, or corner radius. The signal
box has reduced border contrast and a clearer text hierarchy.

At the mobile breakpoint the symbol and action share the first row, while trend
details and the signal box occupy the full second row. The measured document width
is equal to the viewport width, with no horizontal overflow.

## Focused region comparison

The first XAUUSDT candidate row was compared directly because it contains every
reported issue: a long bearish background label, the trend summary, curve detail,
signal box, and action button.

## Required fidelity surfaces

- Fonts and typography: system font hierarchy is consistent; symbol and action
  remain visually dominant, supporting details are quieter, and badge copy does
  not wrap.
- Spacing and layout rhythm: all three desktop columns share the same starting
  baseline; row padding and inter-column gaps are consistent. Mobile rows form a
  predictable two-level layout.
- Colors and visual tokens: existing dark-green product palette is preserved.
  Daily context uses subdued semantic text color rather than an outlined warning
  treatment.
- Image quality and assets: this component contains no raster assets or icons.
- Copy and content: all strategy labels, values, and actions are unchanged.

## Comparison history

1. Initial source: the 80 px symbol column wrapped “初步熊市背景” onto two lines;
   column heights and baselines diverged; signal borders competed with primary
   trend information.
2. Fix: introduced a 150 px desktop symbol track, no-wrap semantic badge, aligned
   grid items, lower-contrast signal styling, and a dedicated mobile grid.
3. Post-fix evidence: desktop child elements start at the same y-coordinate,
   background badge computed `white-space` is `nowrap`, and both desktop and
   mobile report no horizontal overflow.
4. User follow-up identified the outlined pill itself as visually distracting.
   The context label was changed to plain text with computed `border: none`,
   transparent background, and `border-radius: 0px`.

## Findings

No actionable P0, P1, or P2 issues remain in the candidate card.

## Follow-up polish

- P3: consider adding a compact density preference only if the candidate list
  grows substantially beyond the current 20 rows.

final result: passed
