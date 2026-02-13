# InvoiceVault

Invoice-backed short-term credit on programmable rails (IOTA / Move).

InvoiceVault is **not** classical factoring:
- It is a recourse model: the issuer repays at maturity.
- The invoice is the auditable reference instrument, not the collection target.
- The platform does not take balance-sheet risk in the MVP.

This repo contains a demo-ready end-to-end flow: create a claim, list at a discount, fund, and settle on-chain with wallet signatures and transaction digests.

## Slides

- Pitch deck: `docs/InvoiceVault-slides.pdf`

## Documentation

- One pager (pitch): `docs/ONE_PAGER.md`
- Functional spec: `docs/FUNCTIONAL_SPEC.md`
- Technical spec: `docs/TECHNICAL_SPEC.md`
- Operations runbook: `docs/OPERATIONS.md`

## What Is Implemented (MVP)

- **Notarize**: seller uploads an invoice PDF and anchors its SHA-256 hash on-chain.
- **Tokenize**: the claim is represented as a shared `Invoice` Move object (resource model prevents duplication by design).
- **Marketplace**: issuer lists a buy price (discount) and a buyer can fund.
- **Settle**: issuer repays the holder at maturity (recourse) and the on-chain state transitions to a closed status.
- **Risk signal continuity** (demo mode): accelerated default + recovery + rating continuity for a short live demo.

## Quickstart (Frontend)

Prereqs:
- Node.js 20+ and npm
- IOTA wallet extension (for on-chain mode)

```bash
npm install
npm run dev
```

If Turbopack shows a runtime overlay, run dev with Webpack:

```bash
npm run dev -- --webpack
```
Set-Location 'C:\Temp\TokenFactorIOTA'
if (Test-Path .next) { Remove-Item -Recurse -Force .next }
npm run dev -- --webpack

## On-Chain Configuration

The frontend reads package IDs from env per network:

```env
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET=0x...

# Optional UI funding guardrails (demo/compliance hint)
NEXT_PUBLIC_ALLOWLIST=0xabc...,0xdef...
NEXT_PUBLIC_DENYLIST=0x123...,0x456...
```

If the package ID for the selected network is missing, the UI falls back to **local demo persistence** so the flow still works for pitch/demo.

## Fee Model (Move Contract)

- Funding fee: **75 bps** of `discount_price` to treasury.
- Default recovery fee (demo mode only): **800 bps** of `amount`, paid 100% to holder on recovery.

## Repo Structure

- `move/invoice_vault`: Move package (invoice lifecycle + transfers + fee logic + rating).
- `src/app`: Next.js routes: `create`, `marketplace`, `portfolio`.
- `src/lib`: transaction builders + on-chain fetch + local persistence.
- `docs/`: specs + pitch material.
