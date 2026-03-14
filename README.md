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

- **Notarize**: seller uploads an invoice PDF and anchors its SHA-256 bytes on-chain through IOTA Notarization.
- **Tokenize**: the claim is represented as a shared `Invoice` Move object (resource model prevents duplication by design).
- **Marketplace**: issuer lists a buy price (discount) and a buyer can fund.
- **Settle**: issuer repays the holder at maturity (recourse) and the on-chain state transitions to a closed status.
- **Risk signal continuity** (demo mode): accelerated default + recovery + rating continuity for a short live demo.
- **Audit trail UX**: create, notarization, list, fund, cancel, default, repay, and rate digests are surfaced in the app when known.
- **Scoped session switching**: the UI can switch to an already deployed invoice/notarization package pair per network for a clean MVP session without editing env files.
- **Shared data layer**: Create, Marketplace, and Portfolio now read from a common scoped query/cache keyed by `(network, packageId)`.

## Quickstart (Frontend)

Prereqs:
- Node.js 20+ and npm
- IOTA wallet extension (for on-chain mode)

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm run test
npm run check
```

Move contract tests require the IOTA CLI:

```bash
npm run test:move
```

If Turbopack shows a runtime overlay, run dev with Webpack:

```bash
npm run dev -- --webpack
```

## On-Chain Configuration

The frontend reads package IDs from env per network:

```env
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_MAINNET=0x...

# Optional UI funding guardrails (demo/compliance hint)
NEXT_PUBLIC_ALLOWLIST=0xabc...,0xdef...
NEXT_PUBLIC_DENYLIST=0x123...,0x456...
```

`NEXT_PUBLIC_IOTA_PACKAGE_ID_*` is required for the invoice lifecycle. `NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_*` is required for on-chain create because the contract now verifies the notarization object on-chain against the exact deployed notarization package used by the frontend.

If the invoice package ID for the selected network is missing, the UI falls back to **local demo persistence** so the flow still works for pitch/demo.

Session Control also supports a local package-pair override per network:
- Use `Session Control -> Data / Reset -> New MVP Session`.
- Paste the deployed invoice package ID and, for a custom deploy, the matching notarization package ID.
- The app clears the local UI/cache for the current and target scopes, then starts reading from the new package pair immediately.
- Use `Use env package` to return to the env-configured pair.

MVP note:
- Duplicate document protection is enforced per deployed package/registry.
- Uniqueness across multiple redeploys of the contract is out of scope for the MVP.
- A "clean reset" therefore means switching to another already deployed package pair; old on-chain history is not deleted.
- The notarized payload is the raw 32-byte PDF SHA-256 value; lightweight PDF metadata stays on the notarization object as metadata.

Operational note:
- If the invoice package is configured but the matching notarization package is missing, Marketplace and Portfolio can still scope to that deploy, but on-chain Create remains blocked until the notarization package is configured.

## Fee Model (Move Contract)

- Funding fee: **75 bps** of `discount_price` to treasury.
- Default recovery fee (demo mode only): **800 bps** of `amount`, paid 100% to holder on recovery.

## Repo Structure

- `move/invoice_vault`: Move package (invoice lifecycle + transfers + fee logic + rating).
- `move/iota_notarization`: vendored IOTA Notarization package with public state getters used by the on-chain invoice/notarization binding.
- `src/app`: Next.js routes: `create`, `marketplace`, `portfolio`.
- `src/hooks`: shared scoped query hooks for invoice loading.
- `src/lib`: transaction builders + on-chain fetch + local persistence.
- `docs/`: specs + pitch material.
