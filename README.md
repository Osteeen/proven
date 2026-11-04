# Proven

**Give to disaster relief. You're only charged when delivery is proven.**

- **Live app:** https://proven-cwi1.onrender.com - press **"Try the demo"** on the homepage to play every role (donor, charity, supplier and people helped, reviewer). No sign-up needed.
- **Video:** https://www.youtube.com/watch?v=chHCAFIHk4U
- **Real PayPal sandbox, pretend money.** Every payment runs through PayPal's real sandbox APIs. No real money moves.
- **Test PayPal login for giving** (sandbox donor, pretend money): `sb-47bv1e53465976@personal.example.com` / `aAD6pd#5`

### Try it in 3 minutes

Open the live app and press **Try the demo**. Each role opens in a new tab:

1. **Donor** - pick a need, press **Give with PayPal** and log in with the test PayPal account above. Your money is held, not taken.
2. **Charity** - press **Open as the charity** to see its needs, the donations held and each hold's timeline. Paying the supplier is approved in the demo charity's own PayPal sandbox account, which stays private, so the video shows that step.
3. **Supplier and people helped** - press **Open their messages** and answer for them: "yes, it arrived".
4. **Reviewer** - press **Open as the reviewer** to decide anything flagged in the review queue, see the ledger, and the holds timeline.

---

## The problem

When disaster strikes, people give fast - and fraud follows. The FBI's Internet Crime Complaint Center logged 4,500+ complaints and about $96M lost to fraudulent charities, crowdfunding and disaster-relief campaigns in 2024. Donors give, then hope. Most "impact" tools only report back after the money is gone.

## How Proven works

You give. PayPal holds your money. The charity buys the goods and proves they arrived. Only then do you pay - and only for what was spent. If they can't prove it, you pay nothing.

1. **The charity posts a need.** For example: "40 heavy-duty tarps for storm-damaged roofs, $1,200, delivered within 10 days." The goods must arrive within 28 days, because PayPal can hold money for 29. Proven compares the price with what shops charge.
2. **You give.** PayPal holds the money on your account. Nothing is taken yet. You get a private link to follow the need.
3. **The charity buys the goods.** It pays a checked supplier from its own PayPal, through Proven. That PayPal payment is the main proof.
4. **One more check confirms delivery:** the receipt (read by AI), the supplier confirming the handover, or a few of the people helped, picked at random, texting back "yes, I got it".
5. **The charity gets paid what it spent.** Each donor pays a fair share. The rest of every donor's money goes back to them. The charity can never get more than it paid its supplier.
6. **Not proven in time?** The need closes and every donor's money is released. Nobody pays.

Simple, fixed rules decide when the charity gets paid. A person checks anything unclear: a new charity's first payment, anything over $1,000, a price far above market, money asked for before delivery, or a check that is missing or in doubt. **AI can flag a problem, but it never pays anyone.**

### Proven never holds money

Donations are PayPal holds with the **charity as the payee**. When a payment is approved, PayPal moves money from each donor's hold straight to the charity. Proven only decides when, and keeps the record.

---

## How PayPal is used

All calls go to the PayPal **sandbox** REST APIs, directly from the server.

| What | PayPal API | Notes |
|---|---|---|
| Charities and suppliers join | **Partner Referrals** (`POST /v2/customer/partner-referrals`), merchant integrations | Multiparty platform model. Referrals request `PAYMENT`, `REFUND`, `ACCESS_MERCHANT_INFORMATION` and `ADVANCED_TRANSACTIONS_SEARCH`, so Proven can read a supplier's PayPal-confirmed email and legal name. |
| Charities sign in | **Log in with PayPal** (OpenID Connect) | The access token from the code exchange carries all app scopes, so Proven calls userinfo once and discards it. It is never stored. |
| A donation | **Orders v2, `intent=AUTHORIZE`**, `payee.merchant_id` = the charity | One order per donation (PayPal allows one purchase unit per AUTHORIZE order). |
| Paying a donor's share | **Authorization capture**, partial (`final_capture=false`) or final | Shares are split in proportion, in integer cents, capped at what the charity paid suppliers. |
| Holds past day 3 | **Reauthorize** with the remaining amount | Done just before a late capture. The 29-day expiry never moves. |
| Cancelling a hold | **Void** with `PayPal-Auth-Assertion` for the charity | Always voided through the original authorization ID. Tested in sandbox: voiding a reauthorized ID fails. |
| The charity pays its supplier | **Orders v2, `intent=CAPTURE`**, payee = the connected supplier | Proven checks payer, payee and amount on PayPal's record. This payment is the main proof of purchase. |
| Refunds and disputes | **Refunds**, plus dispute and refund webhook events | A supplier refunding the charity sends the need back to a reviewer. |
| Staying in sync | **Webhooks** verified with `verify-webhook-signature`, processed once each; **GET order** for reconciliation | A daily job reconciles open captures and closes holds PayPal reports as lapsed. |

**Never charged twice.** Every capture carries `invoice_id` = Proven's own capture row ID and a stable `PayPal-Request-Id`. PayPal refuses a duplicate, even across a reauthorized hold. Before marking a capture failed, Proven reads the order's own capture list. Anything unclear stays open, and blocks voids until a person looks.

```http
POST /v2/payments/authorizations/{authorization_id}/capture
PayPal-Request-Id: <stable id for this attempt>

{
  "amount": { "currency_code": "USD", "value": "16.67" },
  "final_capture": true,
  "invoice_id": "<Proven capture row id>"
}
```

The `scripts/sandbox/` folder holds the sandbox tests behind these choices: partial captures, reauthorize, charity as payee, reading a charity's own transactions with its permission, the duplicate-capture guard, paying a supplier, and paying the supplier right after a release.

---

## How AI is used

Proven uses **Claude** (Anthropic) to read evidence that would take people hours. A person or a fixed rule always makes the decision.

| Job | Model | What AI does | What it can't do |
|---|---|---|---|
| Receipts | Claude Sonnet (vision, structured output) | Reads the receipt photo: shop, number, date, items, total, and whether it matches the need | Approve a receipt. Code decides pass or review. |
| Copied receipts | None - fixed rules | Each receipt's details are fingerprinted and compared across **every** charity | - |
| Prices | Claude Haiku + Claude Sonnet, with Channel3 | Haiku works out what is bought and how many; Sonnet keeps the like-for-like shop listings and prices them per piece | Block a need. A high price only sends payments to a reviewer. |
| Ask the grid | Claude Haiku, AG Grid AI Toolkit | Turns "biggest charges first, new charities only" into a grid view | See any rows, or change data. It gets the grid's structure only. |
| Donor receipts | None - fixed rules | Written from verified facts only | - |

Receipt text and charity-written words reach the AI as marked data, never as instructions. AI calls have hourly and daily limits.

---

## Tools used and how

| Tool | How Proven uses it |
|---|---|
| **PayPal** | Holds, captures, renewals, voids, refunds, supplier payments, partner onboarding, Log in with PayPal, webhooks and reporting. See above. |
| **AG Grid** (Enterprise 36.2.0) | The reviewer **review queue** (master-detail rows with the proof, and an in-place approve / send back / not proven), the **ledger** (grouped by charity with totals and Excel export), and **Ask the grid** through the AG Grid AI Toolkit. On the timeline page, an AG Grid **holds list shares its records with the Bryntum timeline**: filtering or searching the list filters the timeline, a row finds its bar and a bar finds its row. |
| **Bryntum Scheduler** (7.3.7) | The **holds timeline**: one row per need, one bar per donor's hold from the day PayPal placed it to the day it lapses, with the delivery deadline as a band. Needs running out of time stand out. Shown to reviewers and on the charity dashboard. |
| **Channel3** | **Market price checks**: product search for each need's goods, filtered to like-for-like listings by Claude, priced per piece. "Well above market" sends the need's payments to a reviewer. |
| **Render** | Web service, managed Postgres, environment secrets, and PayPal webhooks on the public URL. Migrations and the demo seed run on every deploy. |
| **GitHub Actions** | Runs the daily job (`POST /api/jobs/daily`): reconciles captures and supplier payments, closes lapsed holds and keeps the demo needs fresh. |
| **Claude** (Anthropic) | Receipt reading, price checks and Ask the grid. See above. |
| **Claude Code** | Used while building Proven: writing and reviewing code, sandbox API tests and security reviews. |

**AG Grid:** Enterprise features run without a licence key, so the grid shows the trial watermark and a console notice. The AG Grid team confirmed this is fine for judging.
**Bryntum:** the public trial package (`@bryntum/scheduler-trial`), which shows a trial notice.

Built with Next.js 16, React 19, TypeScript, PostgreSQL and Drizzle ORM.

---

## Run it locally

**You need:** Node.js 22, PostgreSQL 15 or newer, a PayPal developer account with a sandbox **Platform** app, an Anthropic API key and (optionally) a Channel3 API key.

1. Install packages:
   ```bash
   npm ci
   ```
2. Copy `.env.example` to `.env.local` and fill it in. Variable names:

   | Variable | What it is |
   |---|---|
   | `DATABASE_URL` | Postgres connection string |
   | `AUTH_URL` | `http://127.0.0.1:3000` locally (use `127.0.0.1`, not `localhost` - PayPal's return URL must match) |
   | `AUTH_SECRET` | Random secret for sessions |
   | `PAYPAL_ENV` | `sandbox` (the only value allowed) |
   | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Your sandbox Platform app |
   | `PAYPAL_PARTNER_MERCHANT_ID` | Your platform's sandbox merchant ID |
   | `PAYPAL_PARTNER_ATTRIBUTION_ID` | Optional BN code (not needed in sandbox) |
   | `PAYPAL_WEBHOOK_ID` | The webhook registered for your public URL (deployed only) |
   | `ANTHROPIC_API_KEY` | Claude |
   | `CHANNEL3_API_KEY` | Optional - without it, price checks are skipped |
   | `RECIPIENT_HMAC_KEY` | Random secret used to fingerprint phone numbers (required in production) |
   | `JOB_SECRET` | Bearer secret for `POST /api/jobs/daily` |
   | `DEMO_LOGIN` | `true` to show the "Try the demo" roles |
   | `DEMO_CHARITY_TRACKING_ID`, `DEMO_CHARITY_MERCHANT_ID` | The sandbox charity onboarded through Partner Referrals |
   | `DEMO_SUPPLIER_TRACKING_ID`, `DEMO_SUPPLIER_MERCHANT_ID`, `DEMO_SUPPLIER_EMAIL` | Optional sandbox supplier for the demo |

3. Create the tables and the demo data:
   ```bash
   node --env-file=.env.local node_modules/.bin/drizzle-kit migrate
   ```
   ```bash
   node --env-file=.env.local scripts/db/seed-demo.mjs
   ```
4. Start the app on port 3000 and open **http://127.0.0.1:3000**:
   ```bash
   npx next dev --hostname 127.0.0.1 --port 3000
   ```

**PayPal sandbox setup:** create at least one sandbox Business account (PayPal needs one before it lets you create a Platform app), then a Platform app. Enable **Log in with PayPal** with the return URL `http://127.0.0.1:3000/api/auth/callback/paypal` and the Email and PayPal account ID scopes. Onboard a sandbox Business account as the demo charity through Partner Referrals, and use sandbox Personal accounts as donors.

**Tests:** `npm test` runs the unit tests. Database tests run against a local database with `RUN_DB_TESTS=1`.

---

## Security

- **Money:** integer cents everywhere; captures can never exceed a hold or what the charity paid suppliers (checked in the database, and again right before PayPal is called); idempotent captures; a ledger the database refuses to edit or delete.
- **Access:** every read and change checks that the signed-in charity owns the need. Reviewer pages return "not found" to everyone else, and demo reviewers only see demo charities.
- **PayPal:** webhook signatures verified; sandbox endpoints and keys only; the Log in with PayPal token is never stored.
- **Privacy:** recipients' phone numbers are never stored - only a keyed fingerprint. Donors never see who was helped. Receipt photos are visible only to the charity and reviewers.

## Known limits

- **Sandbox only.** Production needs PayPal approved-partner status. Platform-level Vault and some partner features need PayPal-side enablement.
- **The 28-day window.** A PayPal hold lasts 29 days, so every need must be delivered within 28. Longer projects need longer holds or a "charge on proof" consent from PayPal.
- **The charity pays its supplier first.** Paying the supplier straight from released donor money is the next step, and works best inside PayPal.
- **Price checks depend on shop coverage.** Channel3 covers hardware and outdoor goods well (tarps, sleeping mats, fleece blankets). Bulk or assembled relief items (hygiene kits) often get no verdict. Items sold in packs can be priced per piece by the AI while the need is priced per pack, which gives no verdict - for example water purification tablets.
- **Deadlines for real charities are not enforced yet.** In the demo, the daily job closes needs past their deadline and releases every hold. For real charities that check is not in place yet: until it is, PayPal's 29-day hold lapsing is what gives the money back. Adding it is the next step.
- **The demo keeps itself fresh.** The demo charity's needs move their deadlines forward each day (never past PayPal's hold window), so the demo stays live for anyone trying it. Real charities' deadlines never move.
- **Messages are simulated.** Emails and texts to suppliers and people helped appear on a demo messages page instead of being sent.

---

## Licence

Proven is released under the [MIT Licence](LICENSE).

It depends on third-party packages under their own licences, including **AG Grid Enterprise** (used here without a licence key, so it shows a trial watermark) and the **Bryntum Scheduler public trial**. Using Proven's code does not grant a licence to those packages.
