# InvoiceVault - Operations Runbook

This runbook focuses on running the MVP locally and publishing the Move package to a target IOTA network.

## 1. Prerequisites

- Node.js 20+ and npm
- An IOTA wallet extension (for on-chain mode)
- IOTA CLI with Move support (`iota`)
- Git (recommended; some Move dependency flows assume it)

## 2. Run Frontend Locally

From the project root:

```powershell
npm install
npm run dev
```

Local production build:

```powershell
npm run build
npm run start
```

Recommended verification commands:

```powershell
npm run test
npm run check
```

Move contract tests:

```powershell
npm run test:move
```

If you see a Turbopack runtime overlay, run dev with Webpack:

```powershell
npm run dev -- --webpack
```

## 3. Environment Configuration

Create or update `.env.local`:

```env
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_MAINNET=0x...

# Optional UI buyer-eligibility guardrails (demo/compliance hint)
NEXT_PUBLIC_ALLOWLIST=
NEXT_PUBLIC_DENYLIST=
```

If the invoice package ID is not set for the selected network:
- the UI shows a red banner
- actions use local demo fallback

If you want a clean MVP session without restarting the app:
- publish a new package first
- open `Session Control -> Data / Reset`
- enter the deployed invoice package ID and, for a custom deploy, the matching notarization package ID into `New MVP Session`
- confirm the switch
- use `Use env package` when you want to return to env-based routing

This clears local UI/cache for the current and target scopes and makes the app read from the new package pair immediately.

If the notarization package ID is omitted:
- local demo mode still works
- on-chain Create is blocked, because `invoice_vault` now verifies the notarization object against the exact deployed notarization package

## 4. Build and Publish Move Package

Recommended publish flow:

1. Publish `move/invoice_vault` with unpublished dependencies so the vendored `move/iota_notarization` package is published in the same flow.
2. Record both published package IDs from the CLI output:
   - InvoiceVault package ID
   - IOTA Notarization package ID
3. Set both env variables in `.env.local`.

From `move/invoice_vault`:

```powershell
iota move build
iota client publish --with-unpublished-dependencies --gas-budget 200000000
```

Copy the published package IDs from the CLI output and set the matching variables in `.env.local`:
- `NEXT_PUBLIC_IOTA_PACKAGE_ID_*`
- `NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_*`

Alternative for demo operators:
- keep env values unchanged
- use the Session Control package-pair override to point the UI at another already deployed package pair for that network
- revert with `Use env package` when done

Restart the frontend and verify:
- the "package ID missing" banner is gone
- the Create page no longer shows the missing notarization-package warning
- wallet network matches the selected app network
- Create -> notarize -> list -> fund -> repay produce real transaction digests

### Windows Notes (Common Issues)

If Move build/publish fails due to file locks or dependency fetching:
- Set a short writable Move home directory:

```powershell
$env:MOVE_HOME = 'C:\\m'
```

- If your CLI supports it, try:

```powershell
iota move build --skip-fetch-latest-git-deps
iota client publish --gas-budget 200000000 --skip-fetch-latest-git-deps
```

## 5. Demo Mode (Default Simulation)

For a fast live demo:
1. Open "Session Control" and switch Lifecycle Mode to "Default Simulation".
2. Create an invoice claim and list it at a discount.
3. Fund from a second wallet.
4. Wait ~30 seconds.
5. Buyer executes `mark_defaulted`.
6. Issuer executes `repay_invoice` (recovery payment includes the default fee).

## 6. UI Data Reset (Local Only)

From "Session Control -> Data / Reset":
- `Hide current scope items`
- `Clear current scope cache`
- `New MVP Session` with an already deployed invoice package and matching notarization package for custom deploys
- `Use env package` to return to env-based routing

Semantics:
- `Hide current scope items` only hides records for the active `(network, packageId)` in this browser.
- `Clear current scope cache` removes local cache, hidden IDs, and pending UI flags for the active scope.
- `New MVP Session` switches the active invoice/notarization package pair for the selected network after clearing local UI/cache for both current and target scopes.
- None of these actions delete on-chain invoices, ratings, or transaction history from the old deploy.

## 7. Troubleshooting

### 7.1 Tailwind "Can't resolve 'tailwindcss'"

This usually means the dev server started from the wrong working directory.

Confirm you are in the project root, then rerun:

```powershell
Set-Location <path-to-repo>
npm install
npm run dev
```

### 7.2 Wallet Connected but Cannot Sign

- Ensure wallet network equals the selected app network (banner indicates mismatch).

### 7.3 Create Succeeds but Invoice ID Is Not Visible Yet

- The transaction can be confirmed while indexing is still catching up.
- Use the digest shown in the UI and refresh Portfolio after a few seconds.
- The app preserves locally known terminal states and audit digests while the chain/indexer catches up.

### 7.4 Frontend Does Not Reflect Changes

- Stop dev server
- Delete `.next` (if present)
- Restart `npm run dev` (or `npm run dev -- --webpack`)

### 7.5 `npm run test:move` Fails With "iota not recognized"

- Install the IOTA CLI and ensure `iota` is on `PATH`.
- Reopen the terminal after installation.
- Re-run `npm run test:move` from the repo root.

### 7.6 Rating Is Unavailable for an Older Contract Version

- Portfolio only submits ratings against the active package scope.
- If a position was created under another deploy, switch the app back to the relevant invoice/notarization package pair in `Session Control -> Data / Reset`.
- If that deploy is your default env configuration, use `Use env package` to restore it before rating.
