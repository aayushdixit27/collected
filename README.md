# Collected

**Proof that the truck came.**

A ten-second record of a waste collection — timestamp, location, photo, container — that can
still be found forty-five days later, when someone disputes it.

🔗 **Live:** _pending — link goes here_ · 🎥 **Demo:** _pending_

---

## The finding

Los Angeles publishes what it collects from haulers who cannot prove they showed up.

> **626 liquidated damages letters. $3,432,000 assessed. $2,225,575 paid.**
> — City of Los Angeles, program inception through May 2023

The same report names the evidence that defeats an assessment:

> *"provide a date and time stamped picture of the collection"*

The regulator wrote the product spec. San Diego's 2025 city audit shows the same enforcement
pattern — repeated annual assessments, real invoices, occasional discretionary waivers.

Meanwhile, on the other side of the same missing record, customers describe being billed for
overages weeks after the container is gone: $500 at fourteen days, $414 at one month on a
half-full load of dry dirt, $1,989 refunded only after escalation, on a ticket with no tare
weight recorded. One of them states the structural problem exactly: *"dumpster did not come
with a scale so there is no way of me knowing what the weight is."*

## The crux

**Every expensive dispute in this industry is about an event nobody recorded when it
happened.**

| The dispute | The unrecorded event |
|---|---|
| Overage charge | what it weighed, and the tare |
| Missed pickup | that the truck came, when, and what it found |
| Trip charge | that access was blocked |
| Contamination reclassification | what was in the container |
| Liquidated damages | when the complaint arrived and when it was cured |

The hauler does not lose because they were wrong. They lose because they cannot show they
were right — and in franchised markets the city now fines them on the same missing record.

**Every system in this industry treats a job as done when the truck leaves. The customer, the
contract, and the city all treat it as done when someone can show what happened. That gap is
where the money leaks.**

Which is the same mistake as writing a prompt whose definition of done is "the check passes."
Whatever you tell a system counts as finished is the highest-leverage line in it.

## What it does

**The product is retrieval, not capture.**

Every driver already has a camera. Photos get taken. The photo fails to win the appeal
because nobody can find it six weeks later against the right address on the right date.
"Find me the collection at 1428 Mission on August 12" is the product. Capture is the cheap
half.

1. **Capture** — address, photo, automatic timestamp and geolocation. One screen, one hand,
   from the cab. If it takes longer than ten seconds it produces nothing.
2. **Proof page** — a stable link showing the photo, the timestamp, the pin, the container.
   Send it to a customer. Attach it to an appeal.
3. **Retrieval** — searchable by address and date. The half that does not exist today.

One record. Two readers: the customer who thinks you overcharged them, and the city that says
you missed the stop.

## How the problem was chosen

The build took two hours. Deciding what to build took considerably longer, and that was the
point.

- **Everything is source-graded.** A finding counts if a hauler, a customer, or a regulator
  produced it. A software company describing a problem it sells against is positioning, not
  evidence, and is filed separately. Roughly a third of all search results were vendor
  marketing — in any category where vendor SEO is that dense, the category is occupied, not
  empty.
- **A competing direction was run deliberately**, scoped outside waste entirely, so this one
  had to win rather than be assumed. It returned three candidates, defended two, and
  concluded it had established that each problem exists and willingness to pay for none of
  them. This direction rests on four fully independent sources across four platforms.
- **Everything the company already ships was ruled out first** — billing, dispatch, routing,
  CRM, the communication centre, the driver app, inventory, accounting integrations. The
  interesting territory is the gap beside a shipped feature, never the feature.
- **The first framing was killed.** This started as a customer-facing receipt for overage
  disputes. The evidence said overage disputes are rare and haulers absorb them — one
  operator: *"burned once... we still make good money when that happens."* The penalty
  evidence was quantified and official. Same artifact, better reader. The receipt survives as
  roadmap item two.
- **A graveyard was kept.** Fifteen candidates were killed with reasons written down, so none
  of them comes back in six weeks wearing a different name.

## What was deliberately not built

Non-goals are load-bearing. Scope creep is the default failure mode, and two hours is a spec,
not a suggestion.

No accounts or auth · no scale hardware integration · no billing-system connection · no
payments · no native app · no jurisdiction rules engine · **and not the missed-pickup trigger
or the customer receipt view** — those are roadmap items one and two, cut on purpose, not for
lack of time.

## What this does not establish

- **No hauler was interviewed.** This is public desk research: government records, software
  reviews written by operators, customer complaints, franchise agreements. It is not customer
  validation and is not presented as any. **Getting a hauler on the phone is day one.**
- **The $2.2M is Republic and Waste Management** — national franchise providers, not
  five-truck operators. The mechanism is proven at scale. Whether the economics reach a small
  hauler is the first assumption to test, and it is not tested here.
- **Whether drivers will actually use it is unproven**, and the entire product rests on it.
  That is why the ten-second constraint is a design requirement rather than a nice-to-have.
- Community forums returned nothing usable on several passes. Restaurants and property
  managers are entirely unevidenced. No willingness-to-pay figure was obtained from any
  verified small operator.

## Roadmap

1. **The missed-pickup trigger** — same record, different entry point, and the other half of
   the penalty exposure. A skipped stop generates its own timestamped record and the
   same-day customer notice that franchise agreements already require.
2. **The customer receipt** — the same artifact pointed at the renter instead of the city,
   attached automatically to any overage charge. Turns a surprise bill into a document.
3. **The appeal packet** — the record bundled with the contract clause and the assessment
   letter, so contesting a penalty costs minutes instead of a day of reconstruction.

---

*Built as a take-home. The brief was to build something I had always wanted to build; this
isn't that, and I'd rather say so than pretend. It's what I found when I went looking for a
problem worth two hours in an industry I don't come from.*
