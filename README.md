# Retirement model

Personal retirement modelling for an Australian household. Replaces a spreadsheet.

**This is Phase 4 of the build plan: uncertainty and decisions.** It answers the question the plan opens with — *if I stop full-time work at
age X, spending Y, will the money last, and how confident can I be?* — with Australian
tax, super and Age Pension rules, an age-shaped health cost curve, an aged care stress
test, Monte Carlo simulation over correlated returns and sampled lifespans, four drawdown
strategies, and solvers for both the maximum sustainable spend and the earliest
retirement age. The app lists what is missing on every screen.

## Mortgage and offset

A home loan is opt-in, with its balance, rate, remaining term and offset balance. Per the
build plan (section 2.2), repayments are modelled as **a spending line that ends when the
loan does**, not netted against assets — a household with a mortgage really does have to
find the repayment each year, and the year it stops is a real step down in spending. The
repayment is a fixed nominal amount, so unlike every other spending line it is not indexed:
that is exactly why a mortgage gets easier to carry over time.

The offset reduces interest pound for pound, is still counted as an asset (including in the
Age Pension tests), and earns nothing of its own — its return is the interest it avoids,
untaxed. Two consequences the model gets right and that are easy to get wrong:

- Any offset balance **above** the loan earns nothing at all. The engine warns when it is
  over-funded.
- Once the loan clears, the balance moves to cash. Leaving it in a zero-interest account
  for the rest of the plan would be a modelling artefact, not what anyone would do.

### Offset, or invest?

This is two rows in the levers table, evaluated by running the household **both ways
through the full model** — tax, Age Pension and all — rather than with a rule of thumb.
Each row carries the arithmetic (the loan rate, tax-free and certain, against the expected
return after tax at your marginal rate) and what the projection found.

Those rows report their difference in **dollars of interest**, not years. Moving money
between an offset and investments barely shifts the year the money runs out — a mortgage
of any size moves it either way — so a years column would read "no change" and bury a real
saving. On the shipped example, moving $150,000 into the offset saves $22,675 of interest
and clears the loan five years sooner.

## Where each number comes from

The UI colour-codes provenance, because a figure you typed and a figure taken from the
ATO are not the same kind of thing and should not look alike:

| | Meaning |
|---|---|
| White | Your own figures — edit freely |
| Amber | Assumptions — editable, but a modelling choice, not a fact |
| Sky | Public data — sourced, and therefore **not editable** |
| Indigo | Calculated by the model |

Twenty-one sourced figures (super guarantee, caps, preservation age, Medicare levy, CGT
discount, Age Pension rates and thresholds, deeming, the Work Bonus, aged care fees,
private health premium growth, the health curve and the life tables) are listed read-only
in the sidebar with their source. Changing one means updating the ruleset, not the form.

## The balance chart

Cash, investments and super are stacked; the home is not. It is usually the largest number
in the household and the least spendable, and stacking it flattened the money that actually
funds retirement into a sliver — on the shipped example the y-axis ran to $2.2m and the
run-out year, which is the whole point of the picture, was invisible. It now runs to about
$800k. **Show home** draws the house as a dashed line on its own axis for anyone who wants
it. Every chart ticks every five years rather than labelling all fifty ages, and the
balance chart marks the year work stops and the year the Age Pension starts.

## What would move the needle

A levers table re-runs the whole projection with one change at a time — retire later,
spend less, save more, salary sacrifice, part-time work, downsize (and *when* to downsize),
hold a cash buffer, glide to defensive — and reports what each is worth in years, ranked by
outcome. Apply takes any of them into your inputs.

Downsizing is opt-in, not assumed: it is a major life decision and the tool should not
quietly bake one into your plan. When it is off, the levers offer it at two timings,
because they trade off and the model can settle it — at retirement the equity arrives when
the bridge needs it, but before 55 it forfeits the downsizer contribution. On the shipped
example that difference is stark: downsizing at 47 is worth 27 years, while waiting until
55 is worth nothing, because the money runs out at 53 and never reaches it.

It ranks by outcome, not by what the change costs you: working five more years and
spending $10,000 less are not equivalent sacrifices, and only you can weigh them.

## Your details stay yours

The app ships with **illustrative example figures** — a made-up household, not anyone's
real finances. Edit any field and it becomes yours.

Whatever you enter is kept **for the visit only**, in the tab, and nowhere else. There is
no account, no database and no server to send it to: the projection, the Monte Carlo and
the solvers all run in your browser. The deployed site is static.

Deliberately `sessionStorage` rather than `localStorage`: opening the app starts from the
example every time, rather than quietly resurrecting figures typed days ago. Within a
visit your entries survive moving between the three pages and an accidental reload — which
they must, since the detail and comparison pages are worthless showing the example instead
of your plan. Close the tab and it is gone.

- **Export** writes your scenario to a JSON file you keep
- **Import** reads one back, on any browser or device
- **Reset to example** clears the browser copy and returns to the illustrative figures

Export is the only durable copy — nothing else outlives the tab.

## Two pages

**When can you retire?** (`/`) leads with the answer: the earliest age at which the money
lasts the whole plan, and how far that is from the age you were planning on. A couple gets
**both ages** — two people of different ages who stop work together do not stop at the same
age, so one number cannot describe them. The search shifts both retirements by the same
number of years, which preserves whatever gap the household planned: if one intends to go
three years before the other, they still do. Then the
simulations, which put a probability on it. Then the levers — a table of changes and what
each one is worth.

That headline is **deterministic on purpose**. It is a binary search over a handful of
projections, each well under a millisecond, so it updates while you type — the Monte Carlo
answer takes seconds and cannot sit behind a live number. It is the age that works if
returns behave, not the age that works most of the time, and the page says so. The
probabilistic answer is always later.

**Compare** (`/compare`) puts **up to four** plans side by side. Each starts as a copy of
your saved plan, so the first thing you see is identical columns and every difference after
that is one you made. It shows the outcomes for each and a diff of only the inputs that
differ, highlighting anything that departs from the first column.

Editing is one scenario at a time behind a tab strip — four full input forms side by side
would not fit on any realistic screen, and it is the *comparison* that needs to be side by
side, not the editing.

The simulations run on **the same seed for every scenario**, so each faces identical
sampled futures and a gap between columns is the plan rather than the luck of the draw.
The run count is a fixed total split between the scenarios rather than a fixed number each,
so adding a fourth plan does not double the wait; fewer paths each is a fair trade when the
comparison is paired. Editing here does not touch your saved plan.

**The detail** (`/detail`) has the workings: balances and spending over time, longevity,
the year-by-year table, and everything the model does not cover.

Inputs are shared between the two through the same browser-local store, so switching pages
keeps whatever you have entered.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Edit any input on the left; the projection re-runs
immediately. `npm run build` produces a production build.

## Test it

```bash
npm test        # engine tests, then the form-logic tests
npm run typecheck
```

244 engine tests and 12 covering the form's own logic — the age/birth-year relationship
and the validation applied to a saved or imported scenario.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | The product. A pure, framework-free TypeScript projection engine with no UI or I/O in it. |
| `apps/web` | Next.js App Router UI. Loads the ruleset server-side, runs the engine in the browser. |
| `rules/au-2026-07.json` | Dated Australian regulatory parameters. Every value carries its source URL, effective date and retrieval date. |
| `data/` | Public datasets, each with source URL, retrieval date and a written note on how it was transformed. |
| `docs/` | Your own planning spec, if you keep one here. Gitignored — it is a personal document. |

## Rules and provenance

Regulatory values are **never** written from memory — they change on 1 July each year.
Every leaf in `rules/*.json` carries a `status`:

- `sourced` — fetched from the primary source, with a URL and retrieval date.
- `assumed` — a modelling assumption, surfaced in the UI with an `assumed` badge.
- `unsourced` — a placeholder the engine refuses to use. `assertUsable()` throws if the
  engine depends on one.

Everything in the file was fetched on 2026-09-09.

From the **ATO**: super guarantee 12.00%, concessional cap $32,500, maximum contribution
base $270,830, general transfer balance cap $2.1m, non-concessional cap $130,000,
preservation age table, downsizer age 55 / cap $300,000, contributions tax 15%, fund
earnings tax 15% (nil in retirement phase), minimum drawdown factors by age, resident tax
brackets 2026-27, Medicare levy 2% and its low-income thresholds, LITO, SAPTO, CGT
discount 50%.

From **Services Australia**: Age Pension age 67, maximum rates ($1,200.90 a fortnight
single), income test free areas and taper, assets test limits and cut-offs, deeming rates
and thresholds, and the Work Bonus.

**Age Pension rates change every 20 March and 20 September.** The rates here are those
effective 20 March 2026. Re-fetch after each adjustment.

To move to a new financial year, add `rules/au-2027-07.json` rather than editing the
existing file, so old projections stay reproducible.

## Datasets

| File | What it is |
|---|---|
| `au-life-tables-2020-22.json` | Australian Government Actuary life tables, qx and life expectancy by age and sex, read straight from the published workbook. |
| `au-health-cost-curve.json` | Per-person health spending by age. AIHW system spending by age band divided by ABS population in the same band, indexed against the all-ages average, with the level set by the AIHW's $1,634 average out-of-pocket spend. |
| `au-phi-premium-changes.json` | Industry-average private health insurance premium changes, 1997–2026. Ten-year mean 3.45%, versus a 2.5% CPI assumption. |

Two honest caveats on the health curve, both recorded in the data file itself: the life
tables are **period** tables, so they ignore future mortality improvement and understate
lifespan — the direction that makes money look like it lasts; and out-of-pocket spending
is **assumed** to follow the same age shape as total system spending, which it does not
exactly.

## Uncertainty

`monteCarlo()` runs the projection 5,000 times (about two seconds) with returns drawn from
correlated normals and, optionally, lifespans sampled from the life tables. It reports a
success probability, the distribution of failure ages, and percentile bands for the fan
chart. Every run is seeded, so the same inputs always give the same answer — a probability
that jitters between reloads invites re-rolling until you like the number.

Everything runs on the browser's main thread, so a 5,000-path run pauses the page for
several seconds — a few seconds on a warm desktop browser, longer on the first run while
the JIT warms up. A prominent running indicator is painted before the thread locks up, and
the work is scheduled so that it still starts if the tab is in the background. Moving it to
a Web Worker is the obvious next improvement.

Two solvers bisect on that probability:

- `maxSustainableSpend()` — the most you can spend at a chosen confidence level
- `earliestRetirementAge()` — the earliest you can stop at a chosen confidence level

Both search at a lower run count for speed and then **re-measure the answer at full run
count**, reporting the verified probability rather than the noisy search one.

The strongest check on the whole apparatus is a test: with volatility set to zero, Monte
Carlo must reproduce the deterministic projection exactly, including the same run-out age
and a fan with zero width.

### Drawdown strategies

`outsideSuperFirst` (default), `superFirst`, `proportional`, and `cashBuffer` — which
holds N years of spending in cash and refills it in good years, the sequence-risk defence
the build plan asks for. A glide path can shift super toward defensive options with age.

## What the ruleset already knew

Three sourced values sat in the ruleset unused, and two more were missing entirely.

- **Carry-forward concessional cap.** Unused cap from the last five years can be used on
  top of this year's, while the total super balance at the previous 30 June is under
  $500,000. Modelled as a five-year ring: the sixth year drops off the front, which is
  exactly how the rule expires. A plan can start with cap already banked — the figure myGov
  reports — and it is spent oldest first, as the ATO does. This is what makes the
  "downsize at 55 and contribute" lever actually work.
- **After-tax contributions, with bring-forward.** Already-taxed money, so the fund takes
  nothing off it going in. Bring-forward is modelled by its arithmetic rather than its
  paperwork: a cap is added to the available room each year and the room builds to three
  years' worth, so two quiet years followed by a large contribution behaves as the rule
  intends. Nil at 75, and nil once the balance reaches the transfer balance cap — the
  law's own condition. The money comes out of cash and investments, not from nowhere.
- **The Commonwealth Seniors Health Card**, sourced on 10 September 2026: under $101,105
  single or $161,768 combined, of pension age, and getting no pension. Reported as
  eligibility and never as a dollar figure, because the card is a concession on medicines
  and services and putting a number on it would be a guess. It goes to exactly the
  household that assumes it qualifies for nothing.

**Transition-to-Retirement pensions are deliberately still absent.** They interact with
every cap above and are rarely the difference between retiring and not.

## Renters

A non-homeowner used to get nothing but different assets-test thresholds — no rent in
their spending, no Rent Assistance in their income, wrong in both directions at once.
Answering "no" to *Do you own your home?* now asks for the rent instead of the home value,
charges it every year (working or retired, like the mortgage), and pays Rent Assistance on
top of the pension: **75c for every dollar of fortnightly rent above $154.80 single or
$250.80 for a couple, to a maximum of $219.40 and $206.80** — sourced from Services
Australia on 10 September 2026, and cross-checked against the published maximum-rate rents
before it was encoded. A homeowner gets none of it, and neither does anyone whose pension
has already tapered to nothing.

Downsizing disappears from the levers and the form when there is no home to sell.

## Fees

Nothing was charged for running the money until now, which flattered every projection.
Super and outside-super fees are both deducted from the return before earnings tax —
where a fund actually charges them, so the tax falls with the return. Insurance premiums
deducted from super are a separate line and stop at retirement, as default cover usually
does.

The defaults are **assumptions, not sourced**: 0.6% on super and 0.2% outside it are
middle-of-the-road for a large fund and a broad ETF, but the only honest figure is the one
on your own statement, so both are amber and editable. The size of this matters — 0.7% on
a balance compounding at 7.5% for forty years leaves about 77% of what a fee-free balance
would have reached, which is more than most of the levers are worth.

## Three smaller corrections

- **Voluntary contributions follow pay, not prices.** They index at the wage rate, like
  the salary they are a slice of, and like the cap they are trimmed against. They used to
  index at CPI, which slowly shrank a sacrifice as a share of income.
- **Contents, cars and personal effects count.** Services Australia assesses them at what
  they would fetch. They are added to the assets test and never deemed, because a car
  earns nothing. $20,000 costs an assets-tested pensioner $1,560 a year.
- **An unneeded compulsory drawdown can go back.** Minimum pension payments you did not
  spend sit in cash, where they are deemed for the income test and their earnings taxed at
  your marginal rate. Switching recontribution on puts what the minimum forced out back
  into super, while the person is under 75 and within the non-concessional cap. Off by
  default: it is a decision, not an assumption.

## What Phase 4 does not model

The engine returns these in `notModelled` and the UI shows them in an open panel:

- **Historical return sequences.** The build plan asks for replays of real Australian and
  global sequences ("retiring in 1973"). The replay *mechanism* is built and tested, but
  **no sequences are shipped**: the RBA renumbered its statistical tables and the
  share-market series could not be located on 2026-09-09. A plausible-looking invented
  series would defeat the purpose, since the point of a historical stress test is that the
  returns actually happened. `SHIPPED_SEQUENCES` is deliberately empty and a test asserts
  it. A `-30%` crash-in-year-one test ships instead, because that is a "what if" rather
  than a "what was".
- Volatilities and correlations are **assumed**, not estimated from data — the build plan
  permits a documented default matrix, and `DEFAULT_CORRELATIONS` is it. They drive the
  tails more than the median
- Aged care as a *probability-weighted* cost — it is a deterministic stress test you switch
  on, not a likelihood by age
- Home care packages and the Support at Home program; only residential care is costed
- The ASFA Retirement Standard benchmarks — superannuation.asn.au returns HTTP 403 to
  automated requests, so they could not be sourced
- Transfer of unused SAPTO between spouses
- Reversionary pension mechanics — a death benefit hits the survivor's transfer balance cap
  immediately here, not after the 12-month delay that really applies
- Households of more than two people, and re-partnering
- Franking credits, which would reduce the tax shown
- Investment property, rental income, and asset sales other than the downsize
- Division 296 (the extra 15% above $3m) — not reached on this plan
- Death-benefit tax on super paid to non-dependants
- Phased spending, health-cost curves, aged care (Phase 3)
- Monte Carlo, life tables, sequence-of-returns risk (Phase 4)

## Two modelling choices that move the answer

Both are exposed as `Assumptions` flags, and both are judgement calls rather than facts:

1. **`indexation`** — three separate switches, because they are different kinds of claim.
   Age Pension rates and super caps really are indexed in legislation, so turning those off
   models something that does not happen. Personal tax brackets are **not** indexed in law;
   indexing them assumes governments keep the scale roughly steady in real terms, and not
   indexing them models fifty years of unbroken bracket creep.

   Measured on the base case (deterministic run-out age, and success probability over 1,500
   Monte Carlo paths):

   | | Runs out | Success |
   |---|---|---|
   | All indexed (the default) | 86 | 28.0% |
   | Tax brackets **not** indexed | 82 | 24.1% |
   | Age Pension **not** indexed | 76 | 17.7% |
   | Nothing indexed | 76 | 16.5% |

   So the bracket decision is worth about **four years**, and Age Pension indexation about
   **ten** — but only the first is actually a choice.
2. **Pre-retirement salary tax.** While working, the household is modelled by its net
   savings rate, so tax on salary is already inside that figure. Only the *incremental*
   tax caused by investment income is charged against the portfolio, at the marginal rate
   that income actually attracts.

   What you save is no longer typed: it is **take-home pay less living costs**, worked out
   after every edit. That one change makes the salary-sacrifice lever honest — sacrificing
   lowers take-home, which lowers savings, with no separate bookkeeping and no way for the
   two to disagree — and it replaces a figure nobody knows ("what do I save?") with one
   everybody knows ("what do I spend?"). Living costs exclude the mortgage, which the
   projection charges as its own spending line. Savings can go negative: that means the
   household spends more than it earns, and the gap is funded from the portfolio rather
   than ignored.
3. **Coupled inputs are kept consistent.** Age and birth year are one fact — editing
   either moves the other, on the convention `birthYear = startYear - age`. Birth year is
   not decoration: it sets your preservation age and therefore the year super becomes
   accessible. And nobody can retire in the past, so if your age passes the planned
   retirement age it comes with you. Both were previously unenforced and produced states
   that looked like stale fields but were really impossible scenarios. Pay works the same
   way in the other direction: you enter what actually reaches your account each month,
   and the gross salary the model needs — for the super guarantee, which is paid on top
   of salary — is solved back out of it against the tax scale in the ruleset
   (`grossFromNet`, bisection rather than a hand-rolled inverse, because the LITO tapers
   and the Medicare shade-in put kinks in the curve that are not the tax brackets). The section asks for
   the three lines off a payslip — what reaches your account, what your employer puts
   into super, what you put in yourself — all monthly, because that is how a payslip
   states them. Salary sacrifice
   is taken off before the tax, which is the whole point of sacrificing: $10,000 into
   super costs about $6,100 of take-home at a 39% marginal rate, and the field says so.
   A sacrifice the concessional cap will not take is trimmed to what fits — the same
   trim the projection applies year by year, so the figure quoted is the figure that
   actually goes in. Employer super defaults to the legislated guarantee on the
   salary and follows it, but can be set higher — 15.4%, as much of the public service
   pays, or whatever a package names. It is paid on top of salary, so raising it does not
   cut your take-home; what it does cut is the room left under the concessional cap, and
   a sacrifice squeezed out by that stays in your pay and is taxed there. A figure below
   the guarantee is left as typed and the model uses the minimum instead — an employer
   cannot pay less. What is still assumed away: HELP repayments, reportable fringe
   benefits, and the Division 293 surcharge. Health insurance is entered monthly, as it
   is billed, for the same reason — it is the figure you know. Both derived figures are shown under
   the field, coloured as calculated, and there is nowhere to type them.
4. **Death is an input, not an inference.** Modelling a first death means choosing when.
   Rather than invent a date, it is an explicit scenario event (`kind: 'death'`), default
   off. Phase 4 replaces it with sampling from life tables.
5. **Health and aged care are separate spending lines, not part of the baseline.** Real
   spending falls through retirement (100% / 85% / 75%) while health costs climb with age.
   Folding them together would hide both movements. They only apply from retirement — before
   then the household is modelled by its net savings rate, and recurring living costs are
   already inside that figure.
6. **Gender is not guessed.** It selects which life table applies and is left unset by
   default; the longevity panel simply does not appear until it is chosen. Life expectancy
   at 65 differs by 2.6 years between the two tables. The UI asks for gender; the engine
   field keeps the term the data uses, because the Australian Life Tables are published by
   sex and choosing one is choosing which published table fits best.

## How couples are assessed

The split matters and is easy to get wrong:

| | Assessed |
|---|---|
| Age Pension income & assets tests | **Combined**, against couple thresholds |
| Age Pension payment | **Separately** — each partner bears *half* the reduction |
| Super in accumulation phase | **Exempt** from both tests until its owner reaches Age Pension age |
| Income tax | **Separately**, each on their own income |
| Super | **Separately** — own preservation age, own cap, own pension phase |

The exemption is load-bearing too, and in the other direction: money in the *younger*
partner's accumulation account is invisible to both tests until they turn 67. Holding a
balance there rather than in the older partner's account, or rather than converting it to
a pension, is the most-used Age Pension strategy there is — on a retired couple with a
five-year gap and $400,000 at stake it is worth about $3,900 a year, and more where the
assets test bites across the whole balance. The model reports the exempt amount rather
than leaving you to infer it.

The halving is load-bearing. The $3 per $1,000 assets taper exhausts a couple's *combined*
rate exactly at the published couple cut-off, so an individual partner tapers at $1.50 —
which is also why a couple with only one partner of pension age still cuts out at the full
couple asset limit rather than half of it. Both published cut-offs are pinned by tests.

## A note on module resolution

The engine's internal imports are extensionless (`from './rules'`). Turbopack cannot
resolve the `.js`-suffixed specifiers that Node's own ESM loader requires, and the engine
ships as source so the tests and the browser share one copy. Vitest and Turbopack both
handle extensionless imports; plain `node --experimental-strip-types` does not. If the
engine ever needs to run under bare Node, add a build step rather than reintroducing the
suffixes.

---

General information only. Not personal financial advice.

## Deploying

Pushing to `main` deploys. The repository is connected to Netlify, which builds it from a
clean clone — `npm ci && npm run build` — so anything the build needs has to be committed,
not merely present on the machine that pushed. Pull requests get their own preview URL.

`netlify.toml` builds from the workspace root so the engine package and the `rules/` and
`data/` folders are all present — the app reads those at build time. Base directory is
deliberately blank: pointing it at `apps/web` breaks the workspace resolution and hides
the two data folders. The page is statically prerendered, so the deployed site is static
and every calculation happens in the visitor's browser.

A manual deploy is still possible for a one-off, but the next push to `main` replaces it,
so treat the branch as the source of truth rather than whatever was last uploaded.
