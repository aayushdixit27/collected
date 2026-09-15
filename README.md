# Collected

**Proof that the truck came.**

A ten-second record of a waste collection — timestamp, location, photo, container — that can
still be found forty-five days later, when someone disputes it.

🔗 **Live:** https://collected-nu.vercel.app · 🎥 **Demo:** _pending_

---

## The finding

Los Angeles publishes what it collects from haulers who cannot prove they showed up.

> **626 liquidated damages letters. $3,432,000 assessed. $2,225,575 paid.**
> — City of Los Angeles, program inception through May 2023

These are service-level penalties, not fines for pollution. In a franchised city the hauler
holds a contract with the municipality: a customer reports a missed pickup, which starts a
clock — Los Angeles requires collection by 6pm if reported before 2pm, New York gives twelve
hours, Sonoma twenty-four. Miss the clock and liquidated damages attach per incident.

The same report names the evidence that defeats an assessment:

> *"provide a date and time stamped picture of the collection"*

The regulator wrote the product spec. San Diego's 2025 city audit shows the same enforcement
pattern: repeated annual assessments, real invoices, occasional discretionary waivers.

And the detail that reframes the whole thing — LA documents make-up service *"as documented
in the City CRM."* **The hauler is being judged by the city's record of whether they showed
up, and has nothing of its own to put beside it.**

Meanwhile, on the other side of the same missing record, customers describe being billed for
overages weeks after the container is gone: $500 at fourteen days, $414 at one month on a
half-full load of dry dirt, $1,989 refunded only after escalation, on a ticket with no tare
weight recorded. One of them states the structural problem exactly: *"dumpster did not come
with a scale so there is no way of me knowing what the weight is."*

## How the bill gets late

The mechanism matters, because it explains why the obvious fixes miss.

1. A customer rents a 20-yard at a flat rate that includes one ton.
2. The driver pulls the full can and drives to the transfer station.
3. The scale house weighs in gross, out tare, and issues a **paper ticket** with the net.
4. Net, minus the included ton, times the per-ton rate, is the overage.
5. That ticket now has to get from the truck cab to whoever does the billing.

Step five is the whole problem. Today it travels by crumpled cab, by photo texted into a
WhatsApp group, or by someone re-typing tickets into QuickBooks on a Friday. **The bill is
late because the paper is slow.** The fourteen-day and one-month surprise charges in the
evidence above are that lag, arriving after the container's contents are buried and the
customer has nothing left to argue with.

And notice what the scale ticket does *not* cover. The event has nine parts — delivery,
the fill period, pickup condition and access, transport, the scale, waste classification,
ticket transfer, invoicing, dispute — and **only the scale produces a durable artifact.**
Every argument about overfilling, third-party dumping or blocked access is unwinnable by
either side, because nobody recorded the moment it happened.

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

Every driver already has a camera, and photos do get taken. One operator: *"I did take
photos of the load when I dumped it... If the contractor ever complained, I could show
them."* A customer: *"The guy I use always sends me a pic of the dump ticket."*

So the record is not missing. **It is unaddressable** — sitting in a camera roll as
`IMG_4471.jpg`, or in a text thread, with no address, no date-to-job link, no container.

Which is two failure modes, not one:

- **Retrieval.** The photo exists and cannot be tied to a job. "Find me the collection at
  1428 Mission on August 12" is the product.
- **Coverage.** The moment that decides most disputes, pickup condition and access, is
  never photographed at all, because the only habit operators have is photographing at the
  dump.

The moment that matters is uncaptured; the moment that is captured is unfindable.

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

## How this gets measured

One number, and it is an input rather than an outcome, because an outcome cannot be assigned
to a single change.

> **Percentage of service events with a retrievable record.** Given only an address and a
> date, can someone put a timestamped photo of that event on screen in under thirty seconds?

It is the right number because it contains both failure modes at once. A photo that was never
taken scores zero. A photo sitting unindexed in a camera roll also scores zero. And nothing
downstream survives without it: you cannot win an appeal for a stop you have no record of, or
answer an overage dispute with a recollection.

Three inputs move it: **time to capture** (under ten seconds, which is the adoption lever),
**coverage** (share of scheduled stops with a record), and **time to retrieve** (under thirty
seconds from address and date). Appeals won and dollars recovered are outputs. They follow.

**The one thing this will not trade:** capture speed. If a new field improves the record but
pushes capture past ten seconds, the field loses, because a perfect record nobody creates is
worth zero.

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
