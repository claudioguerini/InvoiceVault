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
- Create -> notarize -> list -> fund -> repay on-chain with wallet signatures and transaction digests.
- Platform funding fee (bps-based) to treasury.
- Demo-mode default/recovery simulation with rating continuity and self-funding guards.
- Optional buyer eligibility filters (frontend allow/deny lists).
- Shared scope-aware loading across Create / Marketplace / Portfolio keyed by network + package.
- Local invoice/notarization package-pair override to start a clean MVP session on an already deployed package pair.
- Local fallback mode when the invoice package ID is not configured.

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
  - Stores per-network invoice/notarization package overrides for MVP session switching.

## 4. Primary User Journeys

### 4.1 Create (Create Invoice)

Goal: create a claim from an invoice PDF.
- Upload an invoice PDF.
- Compute SHA-256 client-side.
- Run a duplicate pre-check against the current scope.
- Create a locked IOTA notarization object where:
  - notarization `state.data` is the raw 32-byte PDF SHA-256
  - notarization `state.metadata` is a fixed InvoiceVault schema marker
  - notarization metadata stores the lightweight PDF details (`mimeType`, `sizeBytes`)
- Enter amount (IOTA) and due date.
- Submit one of:
  - `create_invoice` (Normal mode)
  - `create_invoice_simulation` (Default Simulation mode)

Acceptance criteria:
- User sees a step flow: `Hash -> Duplicate Check -> Notarize -> Create`.
- User sees "waiting for wallet confirmation" state.
- After signing, user sees notarization and invoice transaction digests.
- The contract verifies on-chain that the notarized hash bytes equal `invoice_hash` before creating the invoice object.
- If the selected deploy has an invoice package but no matching notarization package, Create is visibly blocked for on-chain submission.
- If the created object ID is not immediately available (indexing lag), UX remains positive and instructs the user to refresh Portfolio.

Local fallback:
- If package ID is missing for the selected network, the invoice is saved locally and can be demoed end-to-end (no on-chain actions).
- If the invoice package exists but the matching notarization package is missing, the operator must switch to a valid package pair or use the env pair before on-chain Create is available.

MVP note:
- Duplicate document protection is scoped to a single deployed package/registry.
- Cross-redeploy uniqueness is explicitly out of scope in the MVP.
- A fully clean "start from zero" session therefore requires switching to another already deployed package pair.

### 4.2 Marketplace

Goal: list and fund open invoices.

Visibility:
- Shows invoices that are not closed/hidden.
- UI status differentiates:
  - `UNLISTED` (OPEN but no buy price)
  - `LISTED` (OPEN with a buy price)
  - `FUNDED`
- Marketplace supports local search plus sort/filter controls for yield, due date, list status, and seller rating.

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
- Sensitive actions such as cancel include a confirmation prompt in the UI.

### 4.3 Portfolio

Goal: show issuer and buyer positions and allow settlement actions.

Views:
- "As Issuer": invoices where current wallet is `issuer`.
- "As Buyer": invoices where current wallet is `holder`.
- KPI cards summarize issuer and buyer activity (funded, due soon, repaid, average rating, recoveries).
- Audit trail links expose object IDs and known transaction digests in the network explorer.

Issuer actions:
- `repay_invoice()` while `FUNDED` (Normal repayment).
- `repay_invoice()` while `DEFAULTED` (Demo recovery repayment).
- `cancel_invoice()` while `OPEN`.

Buyer actions:
- `mark_defaulted()` while `FUNDED`, Default Simulation mode, and due date has passed.
- `rate_invoice(score)` after invoice is settled:
  - after `REPAID` in Normal mode
  - after `RECOVERED` in Demo recovery flow
- Ratings are submitted only for invoices on the active deploy/package scope; if the UI detects an older package version, the action is left read-only and a warning is shown.
- Sensitive actions such as default marking and cancellation include a confirmation prompt in the UI.

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
  - Create/notarize/list/fund/repay use on-chain transactions.
  - Create/Marketplace/Portfolio share one scoped data source and merge on-chain state with local cache.
  - Local terminal states and known digests may temporarily "win" while indexer catches up.
  - On-chain create also requires the matching notarization package ID for the selected network.

- If package ID is missing:
  - UI shows a red banner and uses local persistence for demo flow.

- If the invoice package ID is present but the notarization package ID is missing:
  - Marketplace and Portfolio can still read the selected deploy.
  - Create stays blocked for on-chain execution until the package pair is complete.

Session reset semantics:
- "Hide current scope items" and "Clear current scope cache" only affect the current browser scope.
- `Session Control -> Data / Reset -> New MVP Session` switches the app to another already deployed invoice/notarization package pair and clears local UI/cache for the current and target scopes.
- None of these actions delete historical on-chain objects or ratings from the old deploy.

## 9. UX/System Messages

- Red banner: package ID missing on the selected network (local fallback enabled).
- Red warning on Create: invoice package is active but the matching notarization package is missing.
- Amber banner: wallet network mismatch vs selected app network.
- Active scope pill: current network + active package (env or local override).
- Portfolio warning: ratings are unavailable when an invoice is detected as belonging to an older package version.
- Empty portfolio messages differ by:
  - wallet disconnected
  - wallet connected but no positions on current network

## 10. Recommended Live Demo (5-7 minutes)

1. Switch to "Default Simulation" in Session Control.
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
