# InvoiceVault - One Pager

## Tagline

Invoice-backed short-term credit on programmable rails.

This is **not** classical factoring:
- Repayment comes from the issuer at maturity (recourse).
- The invoice is the auditable reference instrument, not the collection target.
- The platform does not take balance-sheet risk in the MVP.

## Why Now (Deck Summary)

The pitch deck highlights three structural forces pushing receivables toward automation:
1. Late payments persist, creating a structural SME liquidity gap.
2. E-invoicing is being standardized at EU scale (ViDA; Italy SdI is already mature).
3. Tokenization frameworks and rails are maturing (BIS/FSB style guidance and market readiness).

Slides: `docs/InvoiceVault-slides.pdf`.

## Problem

SMEs involuntarily finance their customers' working capital:
- Late payments create cash trapped in receivables (DSO often ~55-65 days across the EU; higher in parts of Southern Europe).
- SMEs have limited bargaining power: larger counterparties dictate payment terms.
- Traditional factoring has onboarding friction, opacity, and manual underwriting that does not scale to small tickets.

## Solution

InvoiceVault turns invoice claims into **programmable on-chain credit instruments**:
- Seller anchors the invoice PDF hash (SHA-256) on-chain.
- Seller lists a claim at a discounted buy price.
- Buyer funds at discount.
- Seller repays at maturity (recourse).

The on-chain lifecycle creates measurable, portable risk signals (DEFAULTED / RECOVERED tags + ratings), replacing PDF-based trust with an auditable state machine.

## How It Works (4 Steps)

1. Create claim (notarization): invoice hash + metadata on-chain.
2. List: discount price, due date, and terms exposed in the marketplace.
3. Fund: buyer funds at discount; platform fee is applied; status becomes FUNDED.
4. Settle: issuer repays the holder; portfolio and rating update on-chain.

## Value Proposition

Sellers (SMEs):
- Faster cash conversion cycle.
- Predictable, transparent fees.
- Repayment history becomes on-chain credit reputation.
- Recourse model keeps the seller in control and does not disrupt the debtor relationship.

Buyers (capital providers):
- Yield via invoice discount (short duration).
- Real-time portfolio visibility on-chain.
- State-based risk signals, not opaque dashboards.
- Diversifiable across issuers and tenors.

Ecosystem:
- Standardized receivables financing primitives.
- Machine-readable compliance data as a future extension (MiCA-ready intent).
- Integration path with EU e-invoicing rails (ViDA / SdI / Peppol).
- Audit-ready infrastructure from day one.

## What Is Already Proven (MVP)

End-to-end on-chain lifecycle on IOTA with:
- Wallet signatures and real transaction digests.
- Create -> list -> fund -> repay.
- Fee logic and self-funding guard.
- Demo-mode default / recovery simulation and rating continuity.

## Business Model (Deck Summary)

Primary: transaction-based take-rate on successful funding (implemented in contract at 0.75% of buy price).

Expansion: analytics/scorecards, compliance orchestration, partner APIs, and servicing/collections (roadmap).

## Go-To-Market (Deck Summary)

- Now: MVP live end-to-end.
- 3-6 months: Italy pilot cohort (issuer-buyer), KYB/KYC, provenance integrations.
- 6-12 months: indexer + analytics dashboard, smart contract audit, overdue engine.
- 12-18 months: EU scaling (MiCA/DLT Pilot compliance pathway, Spain/France expansion, Peppol/ViDA integration).

Key KPIs:
- time-to-fund
- repayment performance
- repeat usage rate
- default-to-recovery ratio

## Ask (Deck Summary)

EUR 100k-200k to run a regulated pilot and harden the platform for EU scale:
- Product/engineering (indexer, e-invoicing integrations, test automation)
- Security/compliance (audit, KYB/KYC, legal structuring)
- GTM/partnerships (pilot issuer/buyer acquisition, channels)
- Operations (infrastructure hardening, monitoring, incident response)

## Design Principle

InvoiceVault tokens are the on-chain control plane for a claim lifecycle. Legal enforceability requires off-chain legal wrappers: the production roadmap hardens these rails without rebuilding the core primitives.
