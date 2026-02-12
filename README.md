# InvoiceVault (IOTA MVP)

Tokenized invoice factoring demo with:
- Move smart contract: invoice lifecycle with anti-double-funding state machine and on-chain settlement in IOTA coin.
- Next.js frontend: 3 screens (`create`, `marketplace`, `portfolio`).
- Wallet integration: `@iota/dapp-kit` + `@iota/iota-sdk`.

## Documentation

- Functional spec: `docs/FUNCTIONAL_SPEC.md`
- Technical spec: `docs/TECHNICAL_SPEC.md`
- Operations runbook: `docs/OPERATIONS.md`
- One-pager (pitch): `docs/ONE_PAGER.md`

## Project Structure

- `move/invoice_vault`: Move package with `create_invoice`, `create_invoice_simulation`, `list_for_funding`, `fund_invoice`, `mark_defaulted`, `repay_invoice`, `rate_invoice`.
- `src/app/create/page.tsx`: upload PDF, hash client-side, set face value in IOTA, and submit in `Normal` or `Default Simulation` lifecycle mode.
- `src/app/marketplace/page.tsx`: list OPEN/FUNDED invoices, variable discount listing and fund action.
- `src/app/portfolio/page.tsx`: issuer/holder view with repay/default-recovery action, mark-default action, and buyer rating submission (1-5) after repayment.
- `src/lib/invoice-store.ts`: local persistence + allowlist/denylist + lifecycle mode state.

## Run the Frontend

```bash
- npm install
- Set-Location 'C:\Temp\TokenFactorIOTA'
  if (Test-Path .next) { Remove-Item -Recurse -Force .next }
  npm run dev -- --webpack
```

## Run On IOTA Devnet/Testnet

Use this sequence to make the flow fully on-chain (no local fallback).

1. Deploy the Move package to the target network.
```bash
# From move/invoice_vault
# Example CLI shape (verify exact flags with your installed IOTA CLI):
iota client publish --gas-budget 200000000
```

2. Copy the published `packageId` from CLI output.

3. Configure frontend package IDs (env or UI override).
```env
# .env.local
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
```

4. Start frontend and select matching network in header (`devnet` or `testnet`).
   Then connect a wallet on the same network.

5. Confirm status:
- No red banner ("package ID missing")
- No amber banner ("wallet network mismatch")
- Create/List/Fund/Repay show transaction digests

## Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET=0x...

# Optional client-side compliance controls for demo:
NEXT_PUBLIC_ALLOWLIST=0xabc...,0xdef...
NEXT_PUBLIC_DENYLIST=0x123...,0x456...
```

If package IDs are not set, the UI falls back to local demo persistence so the full flow still works during pitch/demo.

## Lifecycle Modes

- `Normal` (default): original flow (`OPEN -> FUNDED -> REPAID`).
- `Default Simulation` (demo-only): simplified default flow without overdue.
  - due date auto-sets at funding time `+30s`
  - status transition `FUNDED -> DEFAULTED` via `mark_defaulted` when due is passed
  - issuer can still repay after default (`DEFAULTED -> RECOVERED`)
  - default fee is applied only in this mode, and goes 100% to buyer/holder

## Move Contract Notes

`move/invoice_vault/sources/invoice_vault.move` includes:
- state machines:
  - `Normal`: `OPEN -> FUNDED -> REPAID`
  - `Default Simulation`: `OPEN -> FUNDED -> DEFAULTED -> RECOVERED`
- anti-fraud guard: no double funding / no repay before funding
- rating:
  - `rate_invoice` allows buyer (`holder`) to rate issuer with a score `1..5`
  - vote is allowed when invoice is `REPAID` or `RECOVERED`
  - one vote per invoice by default
  - exception: if auto-rated `1/5` on default and later recovered, buyer can submit one override
- on-chain settlement:
  - `fund_invoice` applies a 0.75% platform fee on `discount_price`:
    - fee recipient (treasury): `0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b`
    - remaining amount is transferred to issuer
  - `repay_invoice` transfers:
    - normal mode: `amount` from issuer to holder
    - simulation default recovery: `amount + default_fee` from issuer to holder
  - self-funding is blocked on-chain (issuer cannot fund own invoice)
  - `cancel_invoice` (issuer-only, while `OPEN`) marks invoice as `CANCELLED` on-chain
  - `mark_defaulted` (holder-only, simulation mode) marks invoice as `DEFAULTED` after due date
- optional compliance helper: `set_compliance_lists` (issuer-managed allowlist/denylist on invoice)

## Devnet Publish Workaround (Windows)

When publish/build fails because git is missing/unstable or Move lock/rename operations fail:

- use portable MinGit from repo and prepend it to `PATH`
- force `MOVE_HOME` to a simple writable path (`C:\\m`)
- use `tools\\v1.16.2-rc\\iota.exe`
- always pass `--skip-fetch-latest-git-deps`

PowerShell template:

```powershell
$env:MOVE_HOME='C:\m'
$env:Path='c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc;c:\Temp1\TokenFactorIOTA\tools\mingit\git\cmd;' + $env:Path

& 'c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc\iota.exe' move build --path 'c:\Temp1\TokenFactorIOTA\move\invoice_vault' --skip-fetch-latest-git-deps

& 'c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc\iota.exe' client publish 'c:\Temp1\TokenFactorIOTA\move\invoice_vault' --gas-budget 200000000 --skip-fetch-latest-git-deps --json
```

Current devnet package id:
- `0x7ca30248fd6323f559f8ae92db724205356e0736f1290be683560e148a7d22d6`

Reusable note for future chats:
- `For this project, use the on-chain publish workaround: portable MinGit in PATH + MOVE_HOME=C:\m + iota v1.16.2-rc + --skip-fetch-latest-git-deps.`

## Hackathon Flow

1. Create invoice from PDF hash + metadata.
2. List with discount (e.g. EUR 980 for EUR 1000 invoice).
3. Fund from another wallet.
4. Repay from issuer wallet to close claim.
