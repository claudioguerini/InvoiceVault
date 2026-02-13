# InvoiceVault - Functional Specification

## 1. Product Goal

InvoiceVault is an IOTA/Move MVP that makes **invoice-backed short-term credit** programmable:
- Anchor an invoice PDF hash on-chain (notarization).
- Represent the claim lifecycle as a shared `Invoice` Move object (tokenized state).
- Enable discounted funding and on-chain settlement.
- Preserve an auditable risk history via lifecycle tags + ratings.

Important positioning (from the pitch deck):
- This is **not** classical factoring.
- Repayment comes from the issuer at maturity (recourse model).
- The invoice is the reference instrument, not the collection target.
- The platform does not take balance-sheet risk in the MVP.

## 2. Scope (MVP vs Roadmap)

In scope (implemented):
- Create -> list -> fund -> repay on-chain with wallet signatures and transaction digests.
- Platform funding fee (bps-based) to treasury.
- Demo-mode default/recovery simulation with rating continuity and self-funding guards.
- Optional buyer eligibility filters (frontend allow/deny lists).
- Local fallback mode when on-chain package ID is not configured.

Out of scope (explicitly not implemented in MVP):
- Debtor collections workflows / legal assignment machinery.
- Production overdue engine and collections/servicing.
- KYB/KYC/AML and e-invoicing provenance integrations (SdI/Peppol/ViDA) beyond the PDF hash anchor.
- Dedicated indexer (MVP performs a full historical scan).
- Pricing/underwriting engine, risk limits, and analytics dashboards (roadmap).

## 3. Actors and Roles

- Issuer (Seller / SME)
  - Creates the claim.
  - Lists it for funding with a discount price.
  - Receives funding proceeds.
  - Repays at maturity (or recovers after default in demo mode).

- Buyer (Holder / Capital Provider)
  - Funds the claim at discount.
  - Receives repayment (or recovery amount in demo mode).
  - Marks default (demo mode only).
  - Rates the issuer after settlement.

- Treasury
  - Receives the platform fee on successful funding.

- Local System (Browser)
  - Stores local demo records and UI hiding/reset settings.
  - Stores lifecycle mode selection.

## 4. Primary User Journeys

### 4.1 Create (Create Invoice)

Goal: create a claim from an invoice PDF.
- Upload an invoice PDF.
- Compute SHA-256 client-side.
- Enter amount (IOTA) and due date.
- Submit one of:
  - `create_invoice` (Normal mode)
  - `create_invoice_simulation` (Default Simulation mode)

Acceptance criteria:
- User sees "waiting for wallet confirmation" state.
- After signing, user sees transaction digest.
- If the created object ID is not immediately available (indexing lag), UX remains positive and instructs the user to refresh Portfolio.

Local fallback:
- If package ID is missing for the selected network, the invoice is saved locally and can be demoed end-to-end (no on-chain actions).

### 4.2 Marketplace

Goal: list and fund open invoices.

Visibility:
- Shows invoices that are not closed/hidden.
- UI status differentiates:
  - `UNLISTED` (OPEN but no buy price)
  - `LISTED` (OPEN with a buy price)
  - `FUNDED`

Issuer actions (only when issuer wallet is connected):
- `list_for_funding(discount_price)` while `OPEN`
- `cancel_invoice()` while `OPEN`

Buyer actions:
- `fund_invoice()` when `OPEN` and listed
- Self-funding is blocked: issuer cannot fund their own invoice.
- Buyer eligibility can be restricted by allow/deny rules:
  - Frontend guard via env allow/deny list.
  - Contract-level allow/deny list exists as an entry function (not exposed in UI in MVP).

Seller ratings:
- Marketplace can show aggregated seller score (avg + count) and rating history modal (derived from invoices with rating data).

### 4.3 Portfolio

Goal: show issuer and buyer positions and allow settlement actions.

Views:
- "As Issuer": invoices where current wallet is `issuer`.
- "As Buyer": invoices where current wallet is `holder`.

Issuer actions:
- `repay_invoice()` while `FUNDED` (Normal repayment).
- `repay_invoice()` while `DEFAULTED` (Demo recovery repayment).
- `cancel_invoice()` while `OPEN`.

Buyer actions:
- `mark_defaulted()` while `FUNDED`, Default Simulation mode, and due date has passed.
- `rate_invoice(score)` after invoice is settled:
  - after `REPAID` in Normal mode
  - after `RECOVERED` in Demo recovery flow

## 5. Lifecycle and State Machines

### 5.1 Normal Mode

States:
- `OPEN -> FUNDED -> REPAID`
- `OPEN -> CANCELLED` (issuer-only)

No default/overdue logic in normal mode.

### 5.2 Default Simulation Mode (Demo)

States:
- `OPEN -> FUNDED -> DEFAULTED -> RECOVERED`
- `OPEN -> CANCELLED` (issuer-only)

Rules:
- Due date is forced at funding time to `now + 30s` (accelerated demo maturity).
- Buyer can mark default after due date.
- Issuer can still repay after default (recovery).

## 6. Fees and Settlement

- Platform fee on funding: `75 bps` (0.75%) of `discount_price`, paid to treasury.
- Default recovery fee (demo mode only): `800 bps` (8%) of `amount`.
- Repayment:
  - Normal: issuer pays exactly `amount` to holder.
  - Recovery: issuer pays exactly `amount + default_fee` to holder.

## 7. Ratings (Issuer Reputation Signal)

- Rating range: 1..5.
- Rater: buyer/holder.
- Allowed when invoice state is `REPAID` or `RECOVERED`.
- Default rule (demo mode):
  - On `mark_defaulted`, the invoice is auto-rated `1/5` by the holder.
  - After recovery, the holder can submit one override rating.
  - After override, rating becomes immutable.

## 8. Local vs On-Chain Behavior

- If package ID is configured:
  - Create/list/fund/repay use on-chain transactions.
  - Portfolio/Marketplace merge on-chain state with local cache (local terminal states may temporarily "win" while indexer catches up).

- If package ID is missing:
  - UI shows a red banner and uses local persistence for demo flow.

## 9. UX/System Messages

- Red banner: package ID missing on the selected network (local fallback enabled).
- Amber banner: wallet network mismatch vs selected app network.
- Empty portfolio messages differ by:
  - wallet disconnected
  - wallet connected but no positions on current network

## 10. Recommended Live Demo (5-7 minutes)

1. Switch to "Default Simulation" in System Options.
2. Create invoice from PDF hash and list it for funding (discounted buy price).
3. Switch wallet and fund as buyer.
4. Wait ~30 seconds.
5. Buyer marks default.
6. Switch back to issuer and repay (recovery).
7. Buyer optionally overrides rating and shows DEFAULTED/RECOVERED continuity in seller history.

## 11. MVP Limitations

- No dedicated indexer (full historical scan of create transactions).
- No real e-invoicing provenance integrations in MVP (hash anchor only).
- No production overdue engine (demo jumps directly to default).
- No legal enforceability wrappers in code (roadmap requirement).
