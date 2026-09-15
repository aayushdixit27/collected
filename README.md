# Collected

**Proof that the truck came.**

A ten-second record of a waste-container service event — photo, timestamp, location,
container, address — that can still be found weeks later, tied to the right job, when someone
disputes it.

🔗 **Live:** https://collected-nu.vercel.app · 🎥 **Demo:** _pending_

---

## The finding

The charge arrives three weeks late. You ask for proof. The proof doesn't prove anything.

A customer, August 2026, verbatim:

> *"I was charged first and had to call and email to get a copy of the weight ticket showing
> an overage. The weight ticket provided did not have any identifying information that it
> belonged to our reserved container. I cannot confirm it was actually our ticket."*

Corroborated by another:

> *"No tare weight for the truck and dumpster entering, no measured empty weight... All that
> is listed is 'Inbound dirt by yard.'"*

That is not "no record exists." **It is "the record exists and cannot be tied to me."** The
customer states the addressability problem unprompted: a scale ticket with a weight on it and
nothing that connects it to a container, an address, or a date.

The pattern repeats across public customer reviews of several rental companies, 2023 to
2026: overage charges appearing weeks after pickup, a ticket produced on request, and nothing
on the ticket that identifies whose load it was.

## How the bill gets late

The mechanism matters, because it explains why the obvious fixes miss.

1. A customer rents a 20-yard at a flat rate that includes one ton.
2. The driver pulls the full can and drives to the transfer station.
3. The scale house weighs in gross, out tare, and issues a **paper ticket** with the net.
4. Net, minus the included ton, times the per-ton rate, is the overage.
5. That ticket now has to get from the truck cab to whoever does the billing.

Step five is the whole problem. Today it travels by crumpled cab, by photo texted into a
group chat, or by someone re-typing tickets into QuickBooks on a Friday. **The bill is late
because the paper is slow**, and when the ticket finally reaches the customer it carries a
weight and nothing else.

The service event has nine parts — delivery, the fill period, pickup condition and access,
transport, the scale, waste classification, ticket transfer, invoicing, dispute — and **only
the scale produces a durable artifact**, and that artifact is not addressed to a job.

## The crux

**Every expensive dispute in this industry is about an event nobody recorded, against the
right container, when it happened.**

| The dispute | The unrecorded event |
|---|---|
| Overage charge | what it weighed, the tare, and *which container this ticket belongs to* |
| Missed pickup | that the truck came, when, and what it found |
| Trip charge | that access was blocked |
| Contamination reclassification | what was in the container |

The hauler does not lose because they were wrong. They lose because they cannot show they
were right — and the customer cannot check, so the customer assumes the worst.

**Every system in this industry treats a job as done when the truck leaves. The customer
treats it as done when someone can show what happened.** Whatever you tell a system counts
as finished is the highest-leverage line in it.

## What it costs — with its limits stated

Five customers across three companies pair a weight dispute with language about leaving. Read
that carefully: it is **stated intent**, and most of them are one-time residential renters
who were never coming back anyway.

**Exactly one case is a repeat commercial buyer actually moving volume:** a contractor with a
couple hundred rentals behind him, who moved most of his business after one unresolved weight
dispute. One contractor. That is the strongest evidence of consequence in the research, and it
is n=1.

## What it does

**The product is retrieval, not capture.**

Every driver already has a camera, and photos do get taken. So the record is not missing. **It
is unaddressable** — sitting in a camera roll as `IMG_4471.jpg`, or in a text thread, with no
container ID, no address, no date-to-job link. Same failure as the ticket.

1. **Capture** — tap the stop, take the photo, save. Address, container, timestamp and GPS
   are attached automatically. One screen, one hand, no login. If it takes longer than ten
   seconds it produces nothing.
2. **Proof page** — a stable link showing the photo, the timestamp, the pin, the container.
   Send it to a customer with the charge. If the GPS fix is more than a kilometre from the
   stop's scheduled location, the page says so rather than drawing a pin under the wrong
   address.
3. **Retrieval** — searchable by address and date. The half that does not exist today.

One record, two readers: the customer who thinks you overcharged them, and the office that
has to answer them.

## How the problem was chosen

The build took two hours. Deciding what to build took considerably longer, and that was the
point.

- **Everything is source-graded.** A finding counts if a hauler, a customer, or a regulator
  produced it. A software company describing a problem it sells against is positioning, not
  evidence, and is filed separately.
- **A competing direction was run deliberately**, scoped outside waste entirely, so this one
  had to win rather than be assumed.
- **Everything the company already ships was ruled out first** — billing, dispatch, routing,
  CRM, the communication centre, the driver app, inventory, accounting integrations.
- **Two framings were killed.** The first was this one, demoted on the belief that overage
  disputes were rare. The second, a city-penalty appeal record, replaced it for a day and was
  killed on 15 September when the source table was actually read: the penalties covered many
  performance categories, the haulers involved already ran on-board proof-of-service
  technology and paid anyway, and their business was route-based accounts, not temporary
  roll-off. The customer quotes above were the best-evidenced thing left standing, so they
  lead.
- **A graveyard was kept**, so none of it comes back in six weeks wearing a different name.

## What was deliberately not built

No accounts or auth · no scale hardware integration · no billing-system connection · no
payments · no native app · no jurisdiction rules engine · **and not the missed-pickup trigger
or the customer receipt view** — those are roadmap items, cut on purpose, not for lack of
time.

## How this gets measured

One number, and it is an input rather than an outcome, because an outcome cannot be assigned
to a single change.

> **Percentage of service events with a retrievable record.** Given only an address and a
> date, can someone put a timestamped photo of that event on screen in under thirty seconds?

It contains both failure modes. A photo never taken scores zero. A photo unindexed in a camera
roll also scores zero.

**It is computed in the product, not asserted.** The office view's stat strip, read from the
live deployment on 15 September 2026: **91 % coverage (234 of 257 scheduled stops in the
range have a record), 7.6 s median capture, 234 records.** Those are computed over seeded
demo data, so they demonstrate the instrument, not a field result.

Measured timings, honestly labelled:

| Run | Capture | Retrieve |
|---|---|---|
| Live URL, browser automation (a floor) | 4.2 s | 2.2 – 10.8 s |
| Desktop Chrome, human-paced | 8.8 s | 12.8 s |
| Real phone, one capture | **25.1 s** | — |

The 25.1 s is one real capture from a phone by someone using the screen for the first time.
It is over the target by a factor of two and a half, and it is the most important number on
this page, because the entire product rests on whether a driver will do this forty times a
day. Not hidden.

**The one thing this will not trade:** capture speed. If a new field improves the record but
pushes capture past ten seconds, the field loses.

## What this does not establish

- **No hauler was interviewed.** This is public desk research — customer reviews, operator
  reviews, franchise agreements. It is not customer validation and is not presented as any.
  Getting a hauler on the phone is day one.
- **Churn is stated intent from mostly one-time renters, and one contractor.** No dollar
  figure for lost business exists in the research.
- **Whether drivers will actually use it is unproven**, and the one phone measurement says
  not yet at this speed.
- **No willingness-to-pay figure** from any verified small operator.
- Seed data is synthetic: fictional street numbers in six metros, labelled images.

## Roadmap

1. **Ticket-to-container link** — photograph the scale ticket at the transfer station against
   the same container ID and job, so a weight ticket carries the identifying information the
   customer above said was missing.
2. **The customer receipt** — the proof link attached to the overage charge when it is issued,
   not produced on request three weeks later.
3. **Could-not-service notice** — the same record, sent to the customer the same day a stop is
   blocked, overfilled or not out.

---

*Built as a take-home. The brief was to build something I had always wanted to build; this
isn't that, and I'd rather say so than pretend. It is what I found when I went looking for a
problem worth two hours in an industry I don't come from — and it held my attention because
the failure underneath it is a retrieval failure, which is the kind of problem I keep coming
back to.*
