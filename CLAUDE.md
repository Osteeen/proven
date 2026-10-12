# Proven - MAIN entry

See `../CLAUDE.md` for shared hackathon rules, working rules and verified PayPal facts. Brief: https://claude.ai/artifact/YNan38kLpWkgg9Kh5yzyVq

## One line
Give to disaster relief. You are only charged when delivery is proven.

## Flow
1. Charity onboards through Partner Referrals (multiparty). In production PayPal would also confirm charity status.
2. Charity posts a specific, priced need: cost, deadline (fits inside the 29-day hold), required proof. Goods prices checked against market prices (Channel3).
3. Donor pays: Orders v2 `intent=AUTHORIZE`, charity as payee. Proven never holds funds.
4. Funding model A + B (decided): A = reimbursement after proof; B = partial release when a supplier booking/quote is confirmed, rest after delivery (only if multiple partial captures from one authorization work - week 1 test).
5. Charity delivers and submits proof (live in-app photos, receipts, confirmations).
6. Release requires at least two independent checks agreeing. Borderline goes to a human review queue. AI never releases money alone on a borderline case.
7. Proven: capture only the amount actually spent; donor gets an impact receipt written from verified facts only. Not proven by deadline: void, donor never charged. Reauthorize as needed inside 29 days.

## Anti-fraud layers
- Supplier confirmation via contact details we source ourselves (public listing), not from the charity.
- Supplier paid with PayPal = strongest proof (needs partner transaction-search permission - week 1 test).
- Recipient one-tap confirmation to a number recorded at intake.
- Live in-app photo capture with time and place; no gallery uploads.
- AI: receipt and photo reading, matching to the need, platform-wide duplicate detection, edited-document flags.
- Earned trust: small limits and full review for new charities, limits grow with clean history, random audits.

## Focus
Disaster relief first (29-day hold fits fast needs; strongest fraud evidence; specific audience for judges). Design works for any short-term priced need.

## Privacy
Beneficiary consent, automatic face blurring, no beneficiary identities shown to donors.

## Prize targets
Main: Grand Prize or Most Impactful; fallback Best Use of PayPal + AI, Best Demo. SPONSOR POLICY (Osteen, Oct 12): treat every sponsor we use EQUALLY - full, genuine effort on each; no main/backup sponsor. Proven's sponsors, all full effort: Bryntum (timeline of each need vs hold expiry), AG Grid (reviewer queue, ledger), Channel3 (goods prices), Render (hosting, DB, webhooks).

## Competitors (prove impact AFTER payment)
Relief Compass, Promise (blockchain, Network for Good pilots), Aidonic, Aseel. Our difference: the donor is not charged until it is proven.

## Lead
Osteen leads Proven (confirmed Oct 9).

## Week 1 sandbox tests (Oct 7-12)
- Week 1 summary (Oct 9): tests 1,2,3,4,6,7,8 passed; 5 (reauthorize) waits for the 3-day honor period; 9 (plugin MCP) failed - use REST.
- Test 8 PASSED Oct 9: platform can read the charity's transactions/balances with Auth-Assertion (supplier-paid-with-PayPal proof stays). Real charity-to-supplier payment proof to be tested in week 3.
- Test 7 PASSED Oct 9: charity as multiparty payee with partial captures (funding model B confirmed). Void needs PayPal-Auth-Assertion.
- Test 1 PASSED Oct 9: multiple partial captures from one authorization (funding model B viable, recheck with charity as payee). Script: scripts/sandbox/01-auth-partial-captures.mjs
- Authorize, reauthorize, void, capture less than authorized.
- Multiple partial captures from one authorization (decides funding model B).
- Charity as multiparty payee via Partner Referrals onboarding.
- Partner permission to read a charity's PayPal payments to suppliers.

## Timeline
Wk1 tests + stack. Wk2 core (onboarding, needs, holds, capture/void, webhooks, ledger, cross-charity access and double-capture tests). Wk3 proof checks, confirmations, review queue, two-step release. Cosign is built in parallel (Oct 25 checkpoint dropped Oct 9); Proven keeps priority. Dev port 3000. Wk4 Bryntum timeline, AG Grid queue, impact receipts, Channel3, polish. Wk5 security audit, Render deploy, README, video, description. Submit Nov 10.

## Demo moment
Donor funds 50 blankets; receipt + supplier confirmation pass; captured; impact receipt. Another charity submits the same receipt for a different need; flagged; supplier says no such order; those donors are never charged.

## Data from research (cite in pitch)
- FBI IC3 2024: 4,500+ complaints, ~$96M lost to fraudulent charities, crowdfunding and disaster relief campaigns (ic3.gov/PSA/2025/PSA250116).
- FEP Q4 2025: donors down 3.6% (5th straight year), retention 43.3%; micro donors ($1-100) down 10.3% YoY through Q3 2025.
- PayPal charity rate: 1.99% + fixed fee, needs pre-approval.

## Timeline (CHANGED Oct 11)
Build complete by Oct 31. Build 1 Oct 12-18: release, cancel, refunds, webhooks, reauthorize test, early Render deploy ~Oct 14. Build 2 Oct 19-25: proof checks, review queue, human review >$1,000. Build 3 Oct 26-31: Bryntum timeline, AG Grid queue, impact receipts, Channel3, polish, security audit Oct 29-31. Submission Nov 1-10 (deploy Nov 1-3, video + README Nov 4-6, description Nov 7-8, sponsor posts Nov 8-9, submit Nov 10). Proven keeps priority. Sponsors are never cut (Oct 12): Channel3 moves into Build 2; only non-sponsor polish is cut if behind. Dev port 3000.

## Before submission (do not forget)
- Sponsor outreach: coordinator drafts Discord posts per sponsor channel (how we used the tool + live link, repo, video); Osteen posts. See root CLAUDE.md.
- Label sandbox stand-in accounts clearly in the UI (demo charity/store, PayPal sandbox).
