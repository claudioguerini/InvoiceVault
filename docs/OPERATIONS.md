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

# Optional UI buyer-eligibility guardrails (demo/compliance hint)
NEXT_PUBLIC_ALLOWLIST=
NEXT_PUBLIC_DENYLIST=
```

If the package ID is not set for the selected network:
- the UI shows a red banner
- actions use local demo fallback

## 4. Build and Publish Move Package

From `move/invoice_vault`:

```powershell
iota move build
iota client publish --gas-budget 200000000
```

Copy the published `packageId` from the CLI output and set the matching `NEXT_PUBLIC_IOTA_PACKAGE_ID_*` variable in `.env.local`.

Restart the frontend and verify:
- the "package ID missing" banner is gone
- wallet network matches the selected app network
- Create -> list -> fund -> repay produce real transaction digests

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
1. Open "System Options" and switch Lifecycle Mode to "Default Simulation".
2. Create an invoice claim and list it at a discount.
3. Fund from a second wallet.
4. Wait ~30 seconds.
5. Buyer executes `mark_defaulted`.
6. Issuer executes `repay_invoice` (recovery payment includes the default fee).

## 6. UI Data Reset (Local Only)

From "System Options -> Data / Reset":
- Hide current portfolio items
- Hide marketplace items + clear cache

This only affects the browser; it does not delete on-chain objects.

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

### 7.4 Frontend Does Not Reflect Changes

- Stop dev server
- Delete `.next` (if present)
- Restart `npm run dev` (or `npm run dev -- --webpack`)
