# InvoiceVault - Technical Specification

## 1. Stack and versions
- Frontend: Next.js `16.1.6`, React `19.2.3`, TypeScript.
- Wallet/Chain: `@iota/dapp-kit` `0.8.3`, `@iota/iota-sdk` `1.10.1`.
- Smart contract: Move package `move/invoice_vault`.

## 2. High-level architecture
- `Move contract`: state logic, coin transfers, fees, ratings.
- `Next.js frontend`: Create/Marketplace/Portfolio UI plus header/system controls.
- `Browser local store`: invoice cache, hidden ids, lifecycle mode.
- `On-chain loader`: reconstructs invoice state from create transactions and object reads.

## 3. Code structure
- `move/invoice_vault/sources/invoice_vault.move`: main Move module.
- `src/lib/iota-tx.ts`: transaction builders for all entry functions.
- `src/lib/onchain-invoices.ts`: on-chain fetch and parsing.
- `src/lib/invoice-store.ts`: record model and local persistence.
- `src/app/create/page.tsx`: invoice creation.
- `src/app/marketplace/page.tsx`: listing/funding.
- `src/app/portfolio/page.tsx`: repay/default/rating.
- `src/components/app-shell.tsx`: header, tabs, status banners.
- `src/components/system-menu.tsx`: system options (mode, treasury, reset).
- `src/components/app-providers.tsx`: network/wallet/query providers.

## 4. Move contract

### 4.1 Main constants
- `PLATFORM_FEE_BPS = 75` (0.75%).
- `DEFAULT_FEE_BPS = 800` (8%).
- `DUE_OFFSET_SEC_SIMULATION = 30`.
- `TREASURY_ADDRESS = 0x777a...b06b`.

### 4.2 States
- `0 OPEN`
- `1 FUNDED`
- `2 REPAID`
- `3 CANCELLED`
- `4 DEFAULTED`
- `5 RECOVERED`

### 4.3 `Invoice` struct
Relevant fields:
- actors: `issuer`, `holder`
- economic: `amount`, `discount_price`
- time/state: `due_date`, `status`, `funded_at_ms`, `defaulted_at_ms`, `recovered_at_ms`
- rating: `rating_score`, `rated_by`, `auto_default_rating`
- mode: `simulation_mode`, `was_defaulted`
- optional compliance: `allowlist`, `denylist`

### 4.4 Events
- `InvoiceDefaulted`
- `InvoiceRecovered`

### 4.5 Entry function ABI
- `create_invoice(hash, amount, due_date)`
- `create_invoice_simulation(hash, amount, due_date)`
- `list_for_funding(invoice, discount_price)`
- `set_compliance_lists(invoice, allowlist, denylist)`
- `cancel_invoice(invoice)`
- `fund_invoice(invoice, payment_coin, clock)`
- `repay_invoice(invoice, payment_coin, clock)`
- `mark_defaulted(invoice, clock)`
- `rate_invoice(invoice, score)`

### 4.6 Critical on-chain rules
- no self-funding (`issuer != buyer`).
- funding requires exact `discount_price` payment.
- funded repayment requires exact `amount` payment.
- default recovery requires `amount + default_fee`.
- `mark_defaulted` only by holder, only in simulation mode, only after due date.
- auto-rating `1` on default; one override allowed after recovery.

## 5. Frontend transaction layer

`src/lib/iota-tx.ts` maps 1:1 to Move functions:
- create: `buildCreateInvoiceTx`, `buildCreateInvoiceSimulationTx`
- listing/funding: `buildListForFundingTx`, `buildFundTx`
- lifecycle: `buildRepayTx`, `buildMarkDefaultedTx`, `buildCancelTx`
- rating: `buildRateInvoiceTx`

Notes:
- `fund` and `repay` split payment from gas coin.
- `Clock` object id is hardcoded to `0x6`.

## 6. Frontend data model

`InvoiceRecord` in `src/lib/invoice-store.ts` includes:
- core: id, hash, amount, due date, issuer, holder, status
- pricing: discountPrice
- rating: ratingScore, ratedBy, autoDefaultRating
- mode/history: lifecycleMode, wasDefaulted, funded/defaulted/recovered timestamps
- tx metadata: create/fund/repay digest

Persistence:
- `localStorage` for records, hidden ids, lifecycle mode, and reset flags.

## 7. Network and package id config

`src/components/app-providers.tsx`:
- supported networks: `devnet`, `testnet`, `mainnet`
- package id from env:
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET`
  - `NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET`

If package id is missing:
- no on-chain calls;
- local demo fallback is used.

## 8. On-chain fetch algorithm

Implemented in `src/lib/onchain-invoices.ts`:
1. query tx blocks filtered by `MoveFunction`:
   - `create_invoice`
   - `create_invoice_simulation`
2. extract created `objectId` for `::invoice_vault::Invoice`
3. call `multiGetObjects` on collected ids
4. parse Move fields into `InvoiceRecord`
5. keep only `Shared` owner objects
6. sort by `dueDateEpochSec desc`

Known limitation:
- not scalable long term (full historical scan).

## 9. Chain/local merge behavior
- UI merges `onchain + local cache`.
- if local state is terminal but chain is not updated yet (indexing lag), local terminal state is temporarily preferred.
- once chain reaches terminal state, chain data becomes the source of truth.

## 10. Compliance and funding policy
- on-chain: `set_compliance_lists` for per-invoice allow/deny rules.
- frontend: wallet funding filter via env:
  - `NEXT_PUBLIC_ALLOWLIST`
  - `NEXT_PUBLIC_DENYLIST`

## 11. UX/system behavior
- `SystemMenu`:
  - copy package id;
  - lifecycle mode switch;
  - treasury balance;
  - local data reset.
- `AppShell`:
  - missing package banner;
  - wallet-network mismatch banner.
- Marketplace:
  - does not show closed states.
- Portfolio:
  - shows counterparty ratings from both buyer and seller perspectives.

## 12. Risks and technical debt
- No dedicated indexer (full scan approach).
- Uses JS `number` for nano amounts; migrate to `bigint` for high-volume safety.
- No automated Move/frontend test suite in repository (frontend lint only).
- Demo mode controls exist in both UI and on-chain flag; keep them aligned in future changes.

## 13. Recommended evolution
- incremental indexer job with persistent cursors.
- dedicated object/event model for rating history.
- risk analytics (default ratio, recovery ratio, weighted scoring).
- test suite:
  - Move unit/integration tests;
  - frontend component/integration tests;
  - demo-flow e2e smoke tests.
