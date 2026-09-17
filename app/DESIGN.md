# DESIGN.md — Collected

> **Correction, 15 Sep 2026 (late).** The first version of §4's capture contract said "nothing
> else is visible above the fold" and produced a page with one line and one button that the
> user could not identify as an app. It was reverted. §2 and §4 below are rewritten for the
> screens that worked: the dark tools keep their structure and get their failing pairs fixed;
> the proof page alone is a light document. The readability floor in §1 is unchanged.

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
| **Dark tools (capture, office)** | | |
| text `#f4f6f7` on bg `#0b0d0f` | 18.0 | body |
| dim `#a7b0b6` on bg / on surface `#16191c` | 8.8 / 8.0 | labels, metadata |
| placeholder `#b9c2c8` on surface | 9.8 | input placeholders |
| accent-text `#14181b` on accent `#10d6e6` (TrashLab cyan) | 10.0 | the primary action |
| accent-text on green `#33c26a` / red `#ff8080` / grey `#b9c2c8` | 7.7 / 7.4 / 9.9 | status badges, solid |
| dim on surface-2 `#1f2327` | 7.2 | disabled Save |
| red `#ff8080` on bg / surface | 8.0 / 7.3 | GPS-missing line |
| **Document (proof page)** | | |
| TrashLab indigo `#2F2A90` on paper | 11.3 | the one link colour |

Rejected for failing the floor: safety orange `#C2410C` as accent (5.2 with white text),
mid-grey `#6B6B6B` placeholders (5.3), the old grey placeholder `#8a949b` on surface (5.7),
the old red `#ff5c5c` (6.4), translucent badge tints (4.0–6.0), and any disabled state done
with `opacity` (measured 2.08). All of them *look* fine. That is the trap.

Minimum sizes: body 17px on phone, 16px on desktop; secondary and table text 14px, never
below; labels 13px semibold, never 11–12px tracked caps in grey. Line height 1.45. Max
measure 68 characters on the proof page.

## 2. Tokens

Two sets, on purpose. The tools are dark (the screens that worked; drivers asked for nothing
else and the pairs clear the floor). The document is paper.

**Tools (capture, office)** — `public/app.css`
```
--bg #0b0d0f · --surface #16191c · --surface-2 #1f2327 · --border #2c3136 (never text)
--text #f4f6f7 · --text-dim #a7b0b6 · --placeholder #b9c2c8
--accent #10d6e6 (TrashLab cyan; the primary action and nothing else) · --accent-text #14181b
--green #33c26a · --red #ff8080 · badges are solid: accent-text on the colour
--radius 10px on inputs and buttons; chips and badges are pills
```

**Document (proof page)** — `public/proof.css`, the light set below, with `--accent #2F2A90`
(TrashLab indigo) as the single link colour.


```
--paper:      #FFFFFF   page background (tools and document)
--surface:    #F4F2EE   panels, input backgrounds, table header
--rule:       #C9C5BC   hairlines and input borders — never text
--ink:        #111111   text
--ink-2:      #444444   secondary text
--accent:     #2F2A90   TrashLab indigo. ONE use: the document's link colour. (was #1B4D3E)
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

### Capture (`/`) — a tool. Keep the structure that worked.

Top to bottom, every element a signifier or a label: brand line with the purpose (identity,
once) · **route line** "Tuesday route · stop 3 of 6" (place) · TODAY'S STOPS chips, one
scrolling row · ADDRESS OR CONTAINER ID input with a readable placeholder · PHOTO: a dashed
frame with the camera icon and "Take photo" (the frame says what goes there) · STATUS chips,
Collected pre-selected · "+ add note" · **Save**, full width, the one accent element when
enabled, a solid dim pair when disabled (anchor) · a single footer link. Fits 390×844 with
no scroll. Nothing about GPS on this screen.

Confirmation replaces the form: check icon, "Recorded in 6.4 s" largest, the link, Copy
link · Share · Next stop. **GPS is mentioned here only, and only if missing:** "Saved without
a location fix."

Step 3b named: signifiers (chips, input, dashed frame, button), place (route line), regions
(five labelled sections), anchor (Save at the bottom of the form), identity (brand line).

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
