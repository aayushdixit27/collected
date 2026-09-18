# Collected

**The weight ticket, tied to your container.**

The paper ticket a roll-off driver gets at a third-party transfer station, tied to the
customer's container when it is issued, on one page with the pickup photo and the overage
arithmetic — sent with the charge, not produced on request weeks later.

🔗 **Live:** https://getcollected.vercel.app · 🎥 **Demo:** _pending_

---

## The finding

The charge arrives three weeks late. You ask for proof. The proof proves nothing.

Public customer reviews of dumpster-rental companies, 2023 to 2026, describe the same
sequence: an overage charge weeks after the pickup, a scale ticket produced on request, and
nothing on it that says whose load it was. Two of them, verbatim:

> *"The weight ticket provided did not have any identifying information that it belonged to
> our reserved container. I cannot confirm it was actually our ticket."*
> — Trustpilot, Dumpster Rental Enterprises LLC, verified review, 13 August 2026

> *"No tare weight for the truck and dumpster entering, no measured empty weight… All that
> is listed is 'Inbound dirt by yard.'"*
> — BBB complaint 24981374, Budget Dumpster, 25 June 2026; resolved with a $1,989 refund

That is not "no record exists." **It is "the record exists and cannot be tied to me."** The
customer cannot check it, so the customer assumes the worst. Two cases, both single
customers; the quotes were pulled from a draft for a day while their sources were
re-found, and went back in when they were.

## How the bill gets late

The mechanism explains why the obvious fixes miss.

1. A customer rents a 20-yard at a flat rate that includes one ton.
2. The driver pulls the full can and drives to the transfer station.
3. The scale house weighs gross in, tare out, and prints a **paper ticket** with the net.
4. Net, minus the included ton, times the per-ton rate, is the overage.
5. That ticket has to get from the cab to whoever does the billing.

Step five is the whole problem. Today it travels by crumpled cab, photo in a group chat, or
re-typing on a Friday. **The bill is late because the paper is slow**, and when it reaches
the customer it carries a weight and nothing else. Of the nine parts of a service event,
**only the scale produces a durable artifact**, and it is addressed to nobody.

## The crux

**Every expensive dispute in this industry is about an event nobody recorded against the
right container when it happened.**

| The dispute | The unrecorded event |
|---|---|
| Overage charge | **which container this ticket belongs to**, then the net and the tare |
| Missed pickup | that the truck came, when, and what it found |
| Trip charge | that access was blocked |
| Contamination reclassification | what was in the container |

The hauler does not lose because they were wrong; they lose because they cannot show they
were right. **Every system treats a job as done when the truck leaves; the customer, when
someone can show what happened.**

## Where the line is

TrashLab's driver-app page, read 17 September 2026, claims photos, timestamps and GPS "tied
automatically to the right job and container" — their claim, unverified by me, and it makes
the pickup record theirs. Their scale product serves operators who own a scale; a roll-off
hauler dumping at someone else's transfer station still leaves with a paper ticket no system
owns. What this adds is that third-party ticket, tied to the container when it is issued, and
the customer's page with the arithmetic. Their page also lists "overweight loads" as a
structured driver workflow; whether that covers a ticket photo is my first question for
John.

It is not nobody's. **Docket** documents a driver weight-ticket photo flow with field
extraction and customer-visible ticket images on its client dashboard (support pages, read
17 September 2026); ServiceCore can email job attachments with invoices; Hauler Hero,
CurbWaste and Trash Flow tie ticket data to orders. So the honest claim is narrower:
TrashLab does not show it doing this, at least one competitor does, and what this version
adds is the container link and the arithmetic on the customer's page at the cost of one photo
and one number — a difference to test, not a gap to assert.

## What it costs — with its limits stated

Five customers across three companies pair a weight dispute with language about leaving. It
is **stated intent**, and most are one-time residential renters who were not coming back.

Exactly one is a repeat buyer: one customer who, in the wording recorded in my provenance
sheet, "switched to mainly using the other company I preferred" after an unresolved weight
dispute. That is the strongest evidence of consequence in the research; it is n=1, and no
dollar figure for lost business exists anywhere.

## What it does

**The product is the ticket, tied; the pickup photo is the input.**

1. **Pickup** — tap the stop, take the photo, save. Address, container, timestamp and GPS
   attach automatically; past ten seconds a driver stops doing it. TrashLab's driver app
   does this; it is here because the ticket needs a pull to land on.
2. **Ticket** — at the scale, "awaiting a scale ticket" lists today's pulls without one. Tap
   it, photograph the paper ticket, type the net weight, save. One photo, one number; where
   and when it was weighed attach automatically.
3. **Office** — search by address and date; every row says whether a ticket is tied; a
   "Missing ticket" filter lists the pulls that would be billed on nothing.
4. **Customer page** — one stable link: pickup photo → the ticket, gross / tare / net,
   facility, minutes after pickup → the charge. On the pinned demo record: 5,340 lb net, less
   2,000 lb included, is 3,340 lb over, at $95 a ton, **$158.65**. With no ticket tied, the
   page says so in red instead of a number.

## How the problem was chosen

Building took an afternoon. Choosing what to build took far longer; that was the point.

- **Everything is source-graded.** A finding counts if a hauler, a customer, or a regulator
  produced it. A vendor describing a problem it sells against is positioning, not evidence,
  and is filed apart.
- **A competing direction was run**, outside waste entirely, so this one had to win rather
  than be assumed.
- **Everything the company already ships was ruled out first** — billing, dispatch, routing,
  CRM, the communication centre, the driver app, inventory, accounting integrations.
- **Three framings were killed.** The overage receipt, demoted on the belief that weight
  disputes were rare. A record for haulers answering a city regulator's enforcement, dead on
  15 September when the source table was actually opened: the figures spanned many
  performance categories, those haulers already ran on-board proof-of-service technology,
  and their business was route-based accounts, not roll-off. And the pickup photo itself,
  killed on 17 September when TrashLab's driver-app page was read and what I had built sat
  inside their claim. The ticket was what the customer accounts had been about all along.
- **A graveyard was kept**, so none of it comes back wearing a different name.

## What was deliberately not built

No OCR of the ticket · no scale-hardware integration · no billing-system or invoice send · no
accounts or auth · no tamper evidence on the record · no editing a ticket once saved. All cut
on purpose; the first and third are roadmap.

## How this gets measured

One number, an input, because an outcome cannot be assigned to a single change.

> **Share of billed overages that go out with a ticket tied to the container.** Tied means
> the customer's page shows the ticket, the container it was weighed against, when and where
> it was weighed, and the arithmetic.

Zero when the ticket was never photographed; zero when it sits in a text thread. Inputs:
ticket step under 20 s (one photo, one number); tickets tied per pull; the customer's page
under 30 s from address and date. **Reported beside it, not steered:** disputes closed with
evidence and refunds avoided, count and dollars.

**The office strip still shows the previous North Star** — share of scheduled stops with a
record. It measured the pickup, which TrashLab measures itself; superseded, not wrong, and
the ticket figure is the next build. Read from the live API on 17 September 2026: **91 %
(242 of 265 scheduled stops on recorded days), 7.7 s median capture, 253 records** — seeded
data plus two real captures, so the instrument, not a field result.

Timings, honestly labelled:

| Run | Capture | Retrieve |
|---|---|---|
| Browser automation, live URL, first UI (a floor) | 4.2 s | 2.2 – 10.8 s |
| Browser automation, live URL, redesigned UI | 2.5 s | 2.2 s |
| Desktop Chrome, human-paced, first UI | 8.8 s | 12.8 s |
| Real phone, first UI, two captures | 25.1 s, 25.5 s | — |
| Real phone, 17 Sep, pickup step, two captures | **22.7 s, 39.9 s** | — |
| Ticket step, browser automation (lane 2's script, not a hand) | 0.1 s | — |
| **First-time user, own phone, unprompted, 17 Sep evening — pickup, then ticket** | **41.2 s, then 21.9 s** | — |

The phone numbers matter most, because the product rests on a driver doing this forty times
a day, now twice per pull. The last row is the one to read: a product executive who had
never seen the screen, given only the link, recorded a pull and tied a ticket to it in 63
seconds against a 30-second budget, and left gross, tare and facility empty — which is what
"one photo, one number" predicts. Over target by 2×; not hidden.

**The one thing this will not trade:** capture speed. Pickup under ten seconds, ticket one
photo and one number; a field that pushes either past its budget loses.

## How it was built

The spec (`Take-home/09-ticket-spec.md`: record model, API, seed, acceptance criteria, test
plan, non-goals) was written before any code. Three Claude Code lanes then built from that
one contract in parallel on separate worktrees — data and API, driver and office screens,
customer page — each with an independent reviewer its work had to pass before merge. The
merged diff went to a fresh-context review, which found five defects: three fixed before
deploy, two logged below. 185 tests pass. Every commit is on `main`, so the sequence can be
checked rather than believed.

Then it broke in front of someone. In a live demo at 15:00 the store lost five real records:
records lived in one JSON file on Vercel Blob, every write re-read and rewrote it, and Blob's
listing is eventually consistent — a stale read plus a "no index, must be first run" branch
reseeded production. Found from the store's own file history in twenty minutes. Fixed the
same afternoon by removing the design, not patching it: one write-once file per record and
per ticket, nothing ever overwritten, no code path that can reseed on an error; verified on
production with parallel writes. Blob was chosen for a two-hour build because the photos
needed it anyway; a real product puts records in Postgres and keeps Blob for photos. The
seed also renumbered every id when its 45-day window slid at UTC midnight; ids are now keyed
per stop and date. Both are in the log.

## What this does not establish

- **No hauler was interviewed.** This is public desk research, not customer validation. Day
  one is a hauler on the phone: where do your drivers dump, and what does the ticket look like?
- **Two customer accounts, both single cases.** They establish uncertainty and one refund,
  not a rate. No count of how often the ticket cannot be tied exists anywhere.
- **Whether a driver will do a second capture at the scale is unproven**; one first-time user
  did it in 21.9 s, a driver on stop thirty has not been asked.
- **Whether roll-off haulers in TrashLab's base dump at third-party scales** — the premise —
  is plausible and unverified.
- **Whether Docket's customer-visible ticket images already solve this for its users** — I
  read their support pages, not their product.
- **The office list can lag a few seconds** for a record created on another server instance
  (Blob listing is eventually consistent); a record's own link is immediate. Nothing can be
  lost any more, verified with parallel writes on production.
- **Everything seeded is synthetic and labelled**: fictional street numbers in six metros,
  generated tickets with one six-name facility pool, no tare on about 30 % by design. No
  synthetic ticket has been compared to a real one.

## Roadmap

1. **Ticket OCR** — read gross, tare, net and facility off the photo; the driver confirms one
   number instead of typing it.
2. **The charge goes out with the page** — the overage line on the invoice carries the link;
   no office step.
3. **Could-not-service notice** — the same record, sent the day a box is blocked, overfilled
   or not out.

---

*Built as a take-home. The brief was to build something I had always wanted to build; this
isn't that, and I'd rather say so than pretend. It is what I found when I went looking for a
problem worth the hours in an industry I don't come from, and it held me because the failure
underneath is an addressability failure, the kind I keep coming back to.*
