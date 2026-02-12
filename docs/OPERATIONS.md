# InvoiceVault - Operations Runbook

## 1. Prerequisites
- Node.js + npm.
- IOTA browser wallet extension.
- IOTA CLI available (`tools\iota.exe` or `tools\v1.16.2-rc\iota.exe`).

## 2. Run frontend locally
```powershell
npm install
npm run dev
```

Local production build:
```powershell
npm run build
npm run start
```

## 3. Environment configuration
Create or update `.env.local`:
```env
NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET=0x...
NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET=0x...
NEXT_PUBLIC_ALLOWLIST=
NEXT_PUBLIC_DENYLIST=
```

If package id is not set for the selected network:
- UI shows red banner;
- actions use local demo fallback.

## 4. Publish Move on devnet (recommended Windows workaround)

Context:
- on some machines, git and lock-file rename operations are unstable during build/publish.

Official project workaround:
- portable MinGit in PATH;
- `MOVE_HOME=C:\m`;
- `tools\v1.16.2-rc\iota.exe` CLI;
- `--skip-fetch-latest-git-deps` flag.

PowerShell template:
```powershell
$env:MOVE_HOME='C:\m'
$env:Path='c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc;c:\Temp1\TokenFactorIOTA\tools\mingit\git\cmd;' + $env:Path

& 'c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc\iota.exe' move build --path 'c:\Temp1\TokenFactorIOTA\move\invoice_vault' --skip-fetch-latest-git-deps

& 'c:\Temp1\TokenFactorIOTA\tools\v1.16.2-rc\iota.exe' client publish 'c:\Temp1\TokenFactorIOTA\move\invoice_vault' --gas-budget 200000000 --skip-fetch-latest-git-deps --json
```

Current devnet package id:
- `0x7ca30248fd6323f559f8ae92db724205356e0736f1290be683560e148a7d22d6`

## 5. Post-publish checklist
1. Update `.env.local` with the new package id.
2. Verify `move/invoice_vault/Move.lock`:
   - `original-published-id` and `latest-published-id` are aligned.
3. Restart frontend.
4. In UI:
   - select the correct network;
   - verify red/amber banners are not shown;
   - test create -> list -> fund -> repay.

## 6. Demo default mode
For simplified demo:
1. `System Options -> Lifecycle Mode -> Default Simulation`.
2. Create invoice (due date will be forced to funding +30s).
3. Fund from buyer.
4. Wait >30s.
5. Buyer executes `mark_defaulted`.
6. Issuer executes `repay_invoice` (recovery with default fee).

## 7. UI data reset (local only)
From `System Options -> Data / Reset`:
- `Hide current portfolio items`
- `Hide marketplace items + clear cache`

Note:
- browser-local action only;
- does not remove on-chain objects.

## 8. Quick troubleshooting

### 8.1 Wallet connected but cannot sign
- verify wallet network equals selected app network;
- check header mismatch banner.

### 8.2 Create submits tx but object id is not shown immediately
- transaction may be confirmed while indexer is still catching up;
- use digest shown in UI and refresh after a few seconds.

### 8.3 Frontend does not reflect latest changes
- stop active `node` processes;
- clear `.next` if needed;
- restart with `npm run dev` or `npm run start`.

### 8.4 Move build/publish errors on lock/rename/git
- apply workaround from section 4 (MinGit + MOVE_HOME + v1.16.2-rc + skip-fetch).

## 9. Reusable note for future chats
For this project, use the on-chain publish workaround: portable MinGit in PATH + MOVE_HOME=C:\m + iota v1.16.2-rc + --skip-fetch-latest-git-deps.
