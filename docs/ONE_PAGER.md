# InvoiceVault - One Pager

## What It Is
InvoiceVault is an IOTA-based invoice factoring MVP that turns invoice claims into on-chain assets and enables fast liquidity for SMEs.

## Problem
SMEs often wait 30-90 days to get paid, creating cash-flow stress.
Traditional factoring is slow, opaque, and costly for small issuers.

## Solution
InvoiceVault creates a simple on-chain flow:
1. Seller creates invoice claim (PDF hash + metadata).
2. Seller lists it at a discounted buy price.
3. Buyer funds it.
4. Seller repays at maturity.

In demo mode, InvoiceVault also simulates credit risk with default and recovery.

## Why It Matters
- Faster liquidity cycle for issuers.
- Transparent claim lifecycle and settlement.
- Programmable risk behavior (default/recovery + rating history).
- Strong demo-to-production path without rewriting core architecture.

## Product Snapshot
- Frontend: Next.js app (`Create`, `Marketplace`, `Portfolio`).
- Smart contract: Move module on IOTA.
- Wallet integration: `@iota/dapp-kit`.
- On-chain settlement in IOTA coin.
- Platform fee: `0.75%` on funding.
- Default recovery fee (demo mode): `8%` to buyer.

## Lifecycle Modes

### Normal mode
`OPEN -> FUNDED -> REPAID`
Alternative: `OPEN -> CANCELLED`

### Default Simulation mode (demo)
`OPEN -> FUNDED -> DEFAULTED -> RECOVERED`
Alternative: `OPEN -> CANCELLED`

Rules:
- Due date auto-set to funding time +30s.
- Buyer can mark default after due date.
- Issuer can still repay after default (recovery).
- Auto-rating `1/5` on default, then one buyer override allowed after recovery.

## 3-Minute Live Demo Script
1. Set `Mode: Demo` in System Options.
2. Create invoice from PDF hash.
3. List invoice with discount.
4. Switch wallet and fund invoice.
5. Wait ~30 seconds.
6. Buyer marks `DEFAULTED`.
7. Switch back to issuer and repay (`RECOVERED`).
8. Buyer overrides rating and show default/recovered badge in portfolio history.

## What Judges Can Validate Immediately
- Real wallet signatures.
- Real transaction digests.
- On-chain state transitions.
- Economic logic (fees, repayment checks, self-funding block).
- Risk signal continuity (`DEFAULTED/RECOVERED` tags + ratings).

## Current Maturity
- End-to-end MVP implemented and demo-ready.
- On-chain package integrated in frontend.
- Local fallback available for pitch resilience.
- Ops workaround documented for stable Windows publish.

## Near-Term Roadmap
1. Add indexer job (incremental sync, no full historical scan).
2. Expand risk analytics (default ratio, recovery performance, issuer scorecards).
3. Add automated Move + frontend integration tests.
4. Introduce production overdue/collections engine policies.

## Ask / Next Step
Pilot with a small issuer-buyer cohort on devnet/testnet, then harden indexing, compliance, and analytics for production rollout.
