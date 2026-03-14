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
- `@iota/notarization` (locked notarization builder + read API)

Smart contract:
- Move package in `move/invoice_vault` (module `invoice_vault::invoice_vault`)
- Local dependency package in `move/iota_notarization` (vendored IOTA Notarization with extra public read-only getters)

## 2. High-Level Architecture

The MVP is intentionally minimal to remain demo-ready without extra infrastructure:
- Move contract: state machine + transfers + fee logic + rating.
- Next.js frontend: Create / Marketplace / Portfolio UI and system controls.
- Browser local store: demo fallback and UX cache/hide lists.
- React Query + shared scoped hook: central invoice loading/invalidation keyed by `(network, packageId)`.
- On-chain loader: reconstructs invoices by scanning create transactions and reading shared objects.

Pitch-deck roadmap items (indexer, compliance rails, e-invoicing provenance, analytics) are not part of the MVP unless explicitly wired in code.

## 3. Repository Layout

- `move/invoice_vault/sources/invoice_vault.move`: Move module and entry functions.
- `move/iota_notarization/sources/*.move`: vendored IOTA Notarization package used for on-chain binding.
- `src/lib/iota-tx.ts`: transaction builders (1:1 mapping to Move entry functions).
- `src/lib/iota-notarization.ts`: locked IOTA notarization builder + read helpers.
- `src/lib/onchain-invoices.ts`: on-chain discovery (tx scan + object reads).
- `src/lib/invoice-store.ts`: local persistence + lifecycle mode + UI guardrails.
- `src/lib/app-session.ts`: local invoice/notarization package override persistence for MVP sessions.
- `src/lib/explorer.ts`: network-aware explorer links for objects and transaction digests.
- `src/hooks/use-scoped-invoices.ts`: shared React Query loader for scoped invoice state.
- `src/app/create/page.tsx`: PDF hash + create claim flow.
- `src/app/marketplace/page.tsx`: listing + funding flow.
- `src/app/portfolio/page.tsx`: repayment + default simulation + rating flow.
- `src/components/app-providers.tsx`: network config and wallet/query providers.
- `src/components/system-menu.tsx`: Session Control panel for lifecycle mode, treasury balance, package-pair switching, and local reset.

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
- Registry link: `registry_id`
- Notarization link: `notarization_id`
- Claim identity: `invoice_hash`
- Economics: `amount`, `discount_price`
- Lifecycle: `due_date`, `status`, timestamps (`funded_at_ms`, `defaulted_at_ms`, `recovered_at_ms`)
- Reputation: `rating_score`, `rated_by`, `auto_default_rating`
- Demo-mode controls: `simulation_mode`, `was_defaulted`
- Optional compliance lists: `allowlist`, `denylist`

### 4.4 Entry Functions

The module exposes:
- `create_invoice(registry, notarization, invoice_hash, amount, due_date)`
- `create_invoice_simulation(registry, notarization, invoice_hash, amount, due_date)`
- `list_for_funding(invoice, discount_price)`
- `set_compliance_lists(invoice, allowlist, denylist)` (not wired in UI in MVP)
- `cancel_invoice(registry, invoice)`
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
- Cancellation:
  - `cancel_invoice` validates the invoice belongs to the supplied registry
  - cancellation removes the duplicate-hash registry entry, so the same PDF hash can be reused after cancellation on the same deploy
- Notarization binding:
  - `create_invoice*` accepts an immutable reference to the notarization object
  - the notarization must be `Locked`
  - `state.data` must equal the raw 32-byte `invoice_hash`
  - `state.metadata` must equal `application/vnd.invoicevault.pdf-hash+sha256;v=1`

Transfers:
- Funding splits a treasury fee from `discount_price`, then transfers the remainder to issuer.
- Repayment transfers to holder.

Clock:
- Uses `iota::clock::Clock` timestamp for funded/defaulted/recovered time and due-date forcing in simulation mode.

## 5. Frontend Transaction Layer

`src/lib/iota-tx.ts` builds invoice transactions using `Transaction` from the IOTA SDK.

`src/lib/iota-notarization.ts` builds a locked IOTA notarization transaction first, using:
- `state.data = raw 32-byte PDF SHA-256`
- `state.metadata = application/vnd.invoicevault.pdf-hash+sha256;v=1`
- `updatable_metadata = compact JSON with PDF metadata`

The created notarization object is then resolved so its ID can be passed into `create_invoice*`.

Important details:
- Funding and repayment split payment coins from `tx.gas`.
- The Clock object ID is hard-coded as `0x6`.
- The Create flow fetches the created notarization back and verifies metadata + bytes before creating the invoice object.
- The Move contract also verifies the notarization on-chain before minting the invoice object.

## 6. Frontend Data Model and Persistence

`src/lib/invoice-store.ts` defines `InvoiceRecord` used for both on-chain and local fallback.

Persistence:
- `localStorage` stores:
  - invoice records
  - hidden invoice IDs
  - lifecycle mode selection
  - "hide all pending" reset flags
  - per-network invoice/notarization package override pairs for MVP session switching
- Records are scoped by `(network, invoice package id)` to avoid cross-network/demo collisions.

Merge behavior:
- The UI merges on-chain data with local cache.
- If the chain is behind (indexing lag), local terminal states and known digests are temporarily preferred until the chain catches up.

Audit trail fields stored locally when known:
- `notarizationDigest`
- `createDigest`
- `listDigest`
- `fundDigest`
- `cancelDigest`
- `defaultDigest`
- `repayDigest`
- `rateDigest`

Store invalidation:
- Local mutations dispatch a browser event so scoped queries can invalidate without full page refresh.
- Storage listeners keep scoped cache reasonably aligned across tabs/windows in the same browser profile.

## 7. Network and Package ID Configuration

`src/components/app-providers.tsx` uses `createNetworkConfig`:
- Networks: `devnet`, `testnet`, `mainnet`
- Invoice package IDs from env:
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET`
- Required notarization package IDs from env for on-chain create:
  - `NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_DEVNET`
  - `NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_TESTNET`
  - `NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_MAINNET`

If the invoice package ID is missing for the selected network:
- the UI shows a banner
- actions fall back to local demo persistence

If an operator wants a clean MVP session:
- publish a new package externally
- open `Session Control -> Data / Reset`
- enter the already deployed invoice package ID and, for a custom deploy, the matching notarization package ID
- the app stores a local override pair for that network and uses the new package pair immediately
- `Use env package` clears the override pair and returns routing to env configuration

If the notarization package ID is omitted:
- local demo mode still works
- on-chain Create is intentionally blocked, because the contract must bind to the exact deployed notarization package

## 8. On-Chain Discovery Algorithm (No Indexer)

`src/hooks/use-scoped-invoices.ts` + `src/lib/onchain-invoices.ts`:
1. Build a React Query key from `(network, packageId)`.
2. Query `InvoiceCreated` events to recover created invoice IDs.
3. Fallback to tx-block scans for `create_invoice` / `create_invoice_simulation` if events are unavailable.
4. Read objects via `multiGetObjects(showContent, showOwner)`.
5. Keep only `Shared` owner invoices.
6. Parse Move fields, including `notarization_id`, into `InvoiceRecord`.
7. Scan lifecycle transaction history (`list_for_funding`, `fund_invoice`, `cancel_invoice`, `repay_invoice`, `mark_defaulted`, `rate_invoice`) to reconstruct audit digests per invoice when available.
8. Merge with scoped local records and preserve locally-known digests when chain payloads do not carry them.
9. Reuse the same scoped snapshot in Create for duplicate pre-checks instead of re-running a dedicated scan.
10. Sort by due date descending.

Limitation:
- Full historical scan is not scalable long-term; a cursor-based indexer is a roadmap item.
- Duplicate hash protection is scoped to the currently deployed package/registry; cross-redeploy uniqueness is out of scope for the MVP.

## 9. Compliance / Eligibility

Contract-level (optional):
- `set_compliance_lists` stores allow/deny list per invoice (issuer-only, while OPEN).

Frontend-level (implemented as a demo guard):
- `NEXT_PUBLIC_ALLOWLIST` and `NEXT_PUBLIC_DENYLIST` can restrict which wallets can fund from the UI.
- Addresses are normalized before comparison to avoid format-based false negatives/positives.

## 10. Testing and Verification

Available scripts:
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run check`
- `npm run test:move`

Current automated coverage added in this repo:
- Vitest coverage for store/session helpers, analytics helpers, date input parsing, and optimistic merge behavior.
- Move unit tests for duplicate hash rejection, notarization/hash mismatch rejection, dynamic notarization rejection, self-funding rejection, default auto-rating, and recovery override rating.

Operational note:
- `npm run test:move` requires the IOTA CLI to be installed and available as `iota`.

## 11. Known Risks / Technical Debt

- The discovery approach is indexer-less and can be slow as history grows.
- The repo now vendors the notarization Move package locally to expose read-only getters required by the on-chain binding. Operationally, the deployed notarization package ID must therefore stay aligned with frontend configuration.
- Portfolio rating submission is intentionally restricted to the active package scope; if an invoice belongs to an older deploy, the UI leaves the position read-only for rating until the operator switches back to the relevant package pair.

## 12. Roadmap-Aligned Next Steps

- Incremental indexer with persistent cursors + analytics dashboard.
- Smart contract audit + security hardening and monitoring.
- Production overdue/servicing engine and legal wrappers.
- KYB/KYC/AML and e-invoicing provenance integrations (SdI / Peppol / ViDA).
