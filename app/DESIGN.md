# DESIGN.md — Collected

The design decisions, made once, here, so that no screen has to make them again. Every
rule below is a transfer of thinking from the person in the truck cab, or at the office
desk, to this file. If a screen and this file disagree, the screen is wrong.

One idea underneath all of it: **a record is a document, a tool is a tool.** The driver
capture and the office search are tools. The proof page is a document. They are styled
differently on purpose.

## 1. Readability is the floor, not a goal

Text is either readable in direct sun on a phone held at arm's length, or it does not ship.
Contrast ratios below are computed (WCAG 2 formula), not eyeballed. **Every text/background
pair must clear 7:1 (AAA for body text).** Nothing decorative is allowed to lower it.

| Pair | Ratio | Use |
|---|---|---|
| ink `#111111` on paper `#FFFFFF` | 18.9 | body text |
| ink `#111111` on surface `#F4F2EE` | 16.9 | body text on panels |
| secondary `#444444` on paper | 9.7 | labels, metadata, placeholders |
| secondary `#444444` on surface | 8.7 | labels on panels |
| white on accent `#1B4D3E` | 9.6 | the primary action button |
| `#14532D` on `#DCFCE7` | 8.3 | Collected badge |
| `#7F1D1D` on `#FEE2E2` | 8.2 | Could-not-service badge |
| `#1E3A5F` on `#DBEAFE` | 9.4 | Delivered / Removed badge |
| warning `#9A1B1B` on paper | 8.3 | GPS distance warning |

Rejected for failing the floor: safety orange `#C2410C` as accent (5.2 with white text),
mid-grey `#6B6B6B` placeholders (5.3). Both *look* fine. That is the trap.

Minimum sizes: body 17px on phone, 16px on desktop; secondary and table text 14px, never
below; labels 13px semibold, never 11–12px tracked caps in grey. Line height 1.45. Max
measure 68 characters on the proof page.

## 2. Tokens

```
--paper:      #FFFFFF   page background (tools and document)
--surface:    #F4F2EE   panels, input backgrounds, table header
--rule:       #C9C5BC   hairlines and input borders — never text
--ink:        #111111   text
--ink-2:      #444444   secondary text
--accent:     #1B4D3E   ONE use: the primary action. Nothing else is this colour.
--accent-ink: #FFFFFF
--ok-bg/-fg:  #DCFCE7 / #14532D
--bad-bg/-fg: #FEE2E2 / #7F1D1D
--info-bg/-fg:#DBEAFE / #1E3A5F
--warn:       #9A1B1B
--radius:     4px   (6px on buttons)
--touch:      56px  minimum hit target; primary camera button 120px tall
--gap:        8 / 12 / 16 / 24 / 40 px — the only spacing values
```

Fonts. Sans: `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` with
`font-variant-numeric: tabular-nums`. Mono: `ui-monospace, "SF Mono", Menlo, Consolas,
monospace` for everything that is a *fact of record*: IDs, timestamps, coordinates,
container numbers. The mono is what says "this is data" — colour is not allowed to do that
job.

No gradients. No shadows except one 1px hairline. No glass, no blur, no glow. No emoji;
three inline SVG icons at most (camera, pin, search), or none. Pill shapes only on status
badges. Rectangles everywhere else.

## 3. The three principles, applied

**Do the thinking so they don't have to (Krug, Norman).** Every screen has one dominant
action and it is the only accent-coloured element. If two things are green, the screen is
wrong. Defaults are chosen: the nearest stop is pre-selected, "Collected" is assumed, GPS
is attached silently. The user never confirms a default.

**Design for how people behave (Krug, Cooper).** The driver scans, does not read, has one
hand, is in sun. The office user types an address and expects a result before they finish
typing. Nobody reads a label above a field; the field must say what it is.

**Close the loop, calibrated (Norman).** The one thing worth alarming about is "did it
save" — that gets the biggest text on the confirmation screen. GPS being unavailable is
*not* alarm-worthy until the moment it matters, so it is said once, on the saved screen,
in plain words: "Saved without a location fix."

## 4. Screen contracts

### Capture (`/`) — a tool. Three states, one dominant action each.

- **Ready.** Line 1, large: the stop the app thinks you are at (nearest within 300 m by
  GPS, else next in route order), tappable to change; changing opens the stop list *over*
  the screen, never inline. Line 2: the container, mono. Then the camera button: full
  width, 120px tall, accent green, white text "Take photo", the camera icon. Nothing else
  is visible above the fold except a quiet "Other stop…" text button.
- **Photo taken.** The photo fills the top ~45 %. Under it the stop line (still tappable).
  Then Save: full width, accent, the *only* green thing now (the camera button is gone,
  replaced by a small "Retake" text button). Below Save, quiet: "Could not service ▸" which
  reveals the four reasons as plain rectangles; "Add a note". Status chips for Delivered /
  Removed live behind the same disclosure, not on the main path.
- **Saved.** "Recorded in 6.4 s" as the largest text on the page. The link in mono. Three
  equal buttons: Copy link · Share · Next stop. If GPS was missing: one line, warning
  colour, "Saved without a location fix." That is the only place GPS status appears.
- No form labels. No header tagline. The word "Collected" once, small, top-left.

### Proof page (`/p/:id`) — a document.

- White page, max-width 640px, generous margins. Reads like a ticket: title line "Service
  record" with the record ID in mono on the right; the photo; then a two-column facts table
  (label in secondary, value in ink — mono for ID, time, coordinates, container). Rows:
  Status · Address · Container · Captured (local, then ISO in mono, smaller) · Location
  (coordinates, then the distance warning if >1 km, in warning colour, same row) · Note ·
  Received by server. Map after the table, 200px, hairline border, "Open in Google Maps"
  under it as a plain underlined link.
- Two actions only, plain rectangles, not accent: Copy link · Print. Footer line in
  secondary: "Created at the moment of capture. Not editable."
- **Print stylesheet is the primary design.** Screen is the derivative. Printed: one page,
  no map, no buttons, photo ≤ 55 % of page height, every row present.
- "Retrieved in 4.1 s" badge: small, top, secondary text, disappears on print.

### Office (`/office`) — a tool.

- Row 1: the search input is the page's headline — full width on phone, 60 % on desktop,
  with a search icon inside it and placeholder text in `--ink-2` (9.7:1, readable). Date
  from/to beside it on desktop, below it on phone. Status filter last, a plain select.
- Row 2: one line of numbers, not three cards: **"91 % of scheduled stops recorded"** first
  and largest (it is the North Star), then "234 records" and "7.6 s median capture" in
  secondary. All computed. Never a constant.
- Results: a table on ≥ 768px (thumbnail 48px · address · container mono · date, time ·
  status badge · capture s), row hover is a surface-colour band, whole row is the link. On
  phone, the same rows as a list with the address on line 1 and the rest on line 2.
- Empty state, in ink, not grey: "No records for that address in this range. Widen the
  dates." Tagline lives here and nowhere else.

## 5. What is not allowed, so it does not creep back

Dark theme. Yellow. Purple. Gradients. Emoji. Pills on buttons. Cards with borders in a
grid. Grey text under 7:1. A tagline in a header. Icons as decoration. Animation beyond a
120 ms colour transition. Any second accent colour "for variety".

## 6. What this file does not settle

Whether the light palette actually reads better in sun on a real phone (theory says yes;
not measured). Whether the deep green reads as "go" or as "corporate" to a driver — a
question for the three-person test, not for this file. Whether the print layout holds on
Letter and A4 both.
