# InvoiceVault - Technical Specification

This document describes the current architecture and implementation of InvoiceVault as shipped in this repository.

## 1. Stack (Current)

Frontend:
- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS v4 (via `@tailwindcss/postcss`)

Chain + wallet:
- `@iota/dapp-kit` (wallet + providers)
- `@iota/iota-sdk` (client + transactions)

Smart contract:
- Move package in `move/invoice_vault` (module `invoice_vault::invoice_vault`)

## 2. High-Level Architecture

The MVP is intentionally minimal to remain demo-ready without extra infrastructure:
- Move contract: state machine + transfers + fee logic + rating.
- Next.js frontend: Create / Marketplace / Portfolio UI and system controls.
- Browser local store: demo fallback and UX cache/hide lists.
- On-chain loader: reconstructs invoices by scanning create transactions and reading shared objects.

Pitch-deck roadmap items (indexer, compliance rails, e-invoicing provenance, analytics) are not part of the MVP unless explicitly wired in code.

## 3. Repository Layout

- `move/invoice_vault/sources/invoice_vault.move`: Move module and entry functions.
- `src/lib/iota-tx.ts`: transaction builders (1:1 mapping to Move entry functions).
- `src/lib/onchain-invoices.ts`: on-chain discovery (tx scan + object reads).
- `src/lib/invoice-store.ts`: local persistence + lifecycle mode + UI guardrails.
- `src/app/create/page.tsx`: PDF hash + create claim flow.
- `src/app/marketplace/page.tsx`: listing + funding flow.
- `src/app/portfolio/page.tsx`: repayment + default simulation + rating flow.
- `src/components/app-providers.tsx`: network config and wallet/query providers.
- `src/components/system-menu.tsx`: lifecycle mode, treasury balance, local reset.

## 4. Move Contract Details

### 4.1 Constants

From `move/invoice_vault/sources/invoice_vault.move`:
- `PLATFORM_FEE_BPS = 75` (0.75%)
- `DEFAULT_FEE_BPS = 800` (8.0%, demo mode only)
- `DUE_OFFSET_SEC_SIMULATION = 30`
- `TREASURY_ADDRESS = 0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b`

### 4.2 State Encoding

`status` is encoded as:
- `0 OPEN`
- `1 FUNDED`
- `2 REPAID`
- `3 CANCELLED`
- `4 DEFAULTED`
- `5 RECOVERED`

### 4.3 Core Object: `Invoice`

`Invoice` is a shared Move object with:
- Parties: `issuer`, `holder`
- Economics: `amount`, `discount_price`
- Lifecycle: `due_date`, `status`, timestamps (`funded_at_ms`, `defaulted_at_ms`, `recovered_at_ms`)
- Reputation: `rating_score`, `rated_by`, `auto_default_rating`
- Demo-mode controls: `simulation_mode`, `was_defaulted`
- Optional compliance lists: `allowlist`, `denylist`

### 4.4 Entry Functions

The module exposes:
- `create_invoice(invoice_hash, amount, due_date)`
- `create_invoice_simulation(invoice_hash, amount, due_date)`
- `list_for_funding(invoice, discount_price)`
- `set_compliance_lists(invoice, allowlist, denylist)` (not wired in UI in MVP)
- `cancel_invoice(invoice)`
- `fund_invoice(invoice, payment_coin, clock)`
- `repay_invoice(invoice, payment_coin, clock)`
- `mark_defaulted(invoice, clock)` (simulation mode only)
- `rate_invoice(invoice, score)`

### 4.5 Rules / Invariants

Guards:
- Issuer-only: list, cancel, repay.
- Holder-only: mark default and rate.
- Self-funding is blocked: `issuer != buyer`.
- Exact payment invariants:
  - funding must pay exactly `discount_price`
  - normal repayment must pay exactly `amount`
  - recovery repayment (demo) must pay exactly `amount + default_fee`
- Default simulation:
  - `mark_defaulted` only when `now_sec > due_date`
  - auto-rating 1/5 is set on default; after recovery, one override is allowed

Transfers:
- Funding splits a treasury fee from `discount_price`, then transfers the remainder to issuer.
- Repayment transfers to holder.

Clock:
- Uses `iota::clock::Clock` timestamp for funded/defaulted/recovered time and due-date forcing in simulation mode.

## 5. Frontend Transaction Layer

`src/lib/iota-tx.ts` builds transactions using `Transaction` from the IOTA SDK.

Important details:
- Funding and repayment split payment coins from `tx.gas`.
- The Clock object ID is hard-coded as `0x6`.

## 6. Frontend Data Model and Persistence

`src/lib/invoice-store.ts` defines `InvoiceRecord` used for both on-chain and local fallback.

Persistence:
- `localStorage` stores:
  - invoice records
  - hidden invoice IDs
  - lifecycle mode selection
  - "hide all pending" reset flags

Merge behavior:
- The UI merges on-chain data with local cache.
- If the chain is behind (indexing lag), local terminal states are temporarily preferred until the chain catches up.

## 7. Network and Package ID Configuration

`src/components/app-providers.tsx` uses `createNetworkConfig`:
- Networks: `devnet`, `testnet`, `mainnet`
- Package IDs from env:
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET`

If the package ID is missing for the selected network:
- the UI shows a banner
- actions fall back to local demo persistence

## 8. On-Chain Discovery Algorithm (No Indexer)

`src/lib/onchain-invoices.ts`:
1. Query tx blocks filtered by Move function:
   - `create_invoice`
   - `create_invoice_simulation`
2. Extract created object IDs of `::invoice_vault::Invoice`
3. Read objects via `multiGetObjects(showContent, showOwner)`
4. Keep only `Shared` owner invoices
5. Parse Move fields into `InvoiceRecord`
6. Sort by due date descending

Limitation:
- Full historical scan is not scalable long-term; a cursor-based indexer is a roadmap item.

## 9. Compliance / Eligibility

Contract-level (optional):
- `set_compliance_lists` stores allow/deny list per invoice (issuer-only, while OPEN).

Frontend-level (implemented as a demo guard):
- `NEXT_PUBLIC_ALLOWLIST` and `NEXT_PUBLIC_DENYLIST` can restrict which wallets can fund from the UI.

## 10. Known Risks / Technical Debt

- Uses JS `number` for nano amounts; migrating to `bigint` would be safer for large values.
- No automated Move tests or e2e tests in this repo.
- The discovery approach is indexer-less and can be slow as history grows.

## 11. Roadmap-Aligned Next Steps

- Incremental indexer with persistent cursors + analytics dashboard.
- Smart contract audit + security hardening and monitoring.
- Production overdue/servicing engine and legal wrappers.
- KYB/KYC/AML and e-invoicing provenance integrations (SdI / Peppol / ViDA).
