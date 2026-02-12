# InvoiceVault - Functional Specification

## 1. Product goal
InvoiceVault is an invoice factoring MVP on IOTA:
- notarizes invoice PDF hash on-chain;
- tokenizes the claim as a shared `Invoice` object;
- enables discounted funding by a buyer;
- supports repayment and counterparty rating.

The MVP focus is a reliable end-to-end flow for demo and pitch scenarios, including a simplified default simulation mode.

## 2. Actors and roles
- `Issuer` (seller): creates invoice, sets funding price, receives funding, repays.
- `Buyer` (holder): funds invoice, receives repayment, can mark default in demo mode, submits rating.
- `Treasury`: receives platform fee on funding.
- `Local system/user`: configures network/mode and resets local UI cache.

## 3. Pages and use cases

### 3.1 Create
- Upload PDF.
- Compute SHA-256 hash client-side.
- Enter amount (IOTA) and due date.
- Submit `create_invoice` (normal) or `create_invoice_simulation` (demo mode).
- User feedback:
  - wallet signature pending;
  - transaction digest submitted;
  - invoice object id shown when available.

### 3.2 Marketplace
- Shows only non-closed invoices: `OPEN` and `FUNDED`.
- Issuer actions:
  - `list_for_funding` with `discount_price`;
  - `cancel_invoice` while still `OPEN`.
- Buyer actions:
  - `fund_invoice` when invoice is `OPEN` and listed;
  - self-funding blocked (issuer cannot buy own invoice);
  - optional allowlist/denylist constraints.
- Seller ratings:
  - summary badge (average + count);
  - modal with seller rating history.

### 3.3 Portfolio
- Displays wallet positions in two sections:
  - `As Issuer`;
  - `As Buyer`.
- Issuer actions:
  - `repay_invoice` from `FUNDED`;
  - `settle_defaulted` from `DEFAULTED` (demo mode).
- Buyer actions:
  - `mark_defaulted` when `FUNDED`, demo mode, and due date passed;
  - `rate_invoice` after `REPAID` or `RECOVERED`.
- Counterparty access:
  - each card can open counterparty ratings modal (buyer or seller).

## 4. Functional lifecycles

### 4.1 Normal mode
States:
- `OPEN -> FUNDED -> REPAID`
- alternative branch: `OPEN -> CANCELLED`

Notes:
- no overdue/default logic.
- no default fee.

### 4.2 Default Simulation mode (demo)
States:
- `OPEN -> FUNDED -> DEFAULTED -> RECOVERED`
- alternative branch: `OPEN -> CANCELLED`

Rules:
- at funding, due date is forced to `now + 30s`;
- buyer can execute `mark_defaulted` after due date;
- issuer can still repay after default (recovery).

## 5. Fees and settlement
- Platform fee on funding: `0.75%` (`75 bps`) of `discount_price`, paid to treasury.
- Default recovery fee (demo mode only): `8%` (`800 bps`) of `amount`.
- Recovery required payment:
  - `amount + default_fee`
  - transferred `100%` to buyer/holder.

## 6. Rating and feedback
- Rating range: `1..5`.
- Rater: buyer (`holder`) rating the issuer.
- Allowed when invoice state is `REPAID` or `RECOVERED`.
- Special default rule:
  - on `mark_defaulted`, system applies auto-rating `1/5`;
  - if invoice later becomes `RECOVERED`, buyer can submit one manual override;
  - after override, rating becomes immutable.

## 7. Visibility and reset behavior
- Marketplace does not show closed transactions (`REPAID`, `CANCELLED`, `DEFAULTED`, `RECOVERED`).
- `System Options` reset is browser-local only:
  - hides current items;
  - clears local cache;
  - does not delete on-chain data.

## 8. Main system messages
- Red banner: package ID missing, local fallback enabled.
- Amber banner: wallet network differs from selected network.
- Empty portfolio:
  - wallet disconnected: connect prompt;
  - wallet connected with no positions: explicit network-scoped empty state.

## 9. Recommended demo flow (5-7 minutes)
1. Set `Mode: Demo` from System Options.
2. Create invoice and list_for_funding.
3. Fund from buyer wallet.
4. Wait ~30s.
5. Buyer marks default.
6. Issuer performs recovery repay.
7. Buyer optionally overrides rating and shows badges/history.

## 10. MVP functional limits
- No separate overdue engine: demo flow moves directly to default.
- No physical on-chain deletion (only `CANCELLED` status).
- No dedicated indexer: invoice discovery uses create transaction scan + `multiGetObjects`.
