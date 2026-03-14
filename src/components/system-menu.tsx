"use client";

import { useIotaClient } from "@iota/dapp-kit";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPackageOverride,
  savePackageOverride,
} from "@/lib/app-session";
import { buildObjectExplorerUrl } from "@/lib/explorer";
import { normalizeIotaObjectIdValue } from "@/lib/iota-ids";
import {
  LifecycleMode,
  clearScopeUiState,
  loadLifecycleMode,
  saveLifecycleMode,
  setPortfolioHideAllPending,
} from "@/lib/invoice-store";
import { formatIota } from "@/lib/iota-amount";
import {
  useActiveStorageScope,
  useEffectivePackages,
} from "@/components/app-providers";

const TREASURY_ADDRESS =
  "0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b";

function shortenPackageId(value: string | null | undefined) {
  if (!value) return "Local demo";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function SystemMenu() {
  const iotaClient = useIotaClient();
  const {
    envNotarizationPackageId,
    envPackageId,
    hasNotarizationPackageOverride,
    hasPackageOverride,
    network,
    notarizationPackageId,
    packageId,
  } = useEffectivePackages();
  const storageScope = useActiveStorageScope();
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copiedPackage, setCopiedPackage] = useState(false);
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>("NORMAL");
  const [treasuryBalance, setTreasuryBalance] = useState<string | null>(null);
  const [loadingTreasury, setLoadingTreasury] = useState(false);
  const [treasuryError, setTreasuryError] = useState("");
  const [packageInput, setPackageInput] = useState("");
  const [notarizationPackageInput, setNotarizationPackageInput] = useState("");
  const [packageMessage, setPackageMessage] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePackageExplorerUrl = packageId
    ? buildObjectExplorerUrl(packageId, network)
    : null;
  const scopeLabel = shortenPackageId(packageId);

  const loadTreasuryBalance = useCallback(async () => {
    setLoadingTreasury(true);
    setTreasuryError("");
    try {
      const balance = await iotaClient.getBalance({ owner: TREASURY_ADDRESS });
      setTreasuryBalance(formatIota(balance.totalBalance));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load treasury balance.";
      setTreasuryError(message);
      setTreasuryBalance(null);
    } finally {
      setLoadingTreasury(false);
    }
  }, [iotaClient]);

  useEffect(() => {
    if (!open) return;
    setLifecycleMode(loadLifecycleMode());
    setPackageInput(packageId || "");
    setNotarizationPackageInput(notarizationPackageId || "");
    setPackageMessage("");
    void loadTreasuryBalance();
  }, [open, network, notarizationPackageId, packageId, loadTreasuryBalance]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const container = containerRef.current;
      if (!container) return;
      const target = event.target as Node | null;
      if (!target || container.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function onHideCurrentScopeItems() {
    const confirmed = window.confirm(
      "Hide the currently tracked marketplace and portfolio items for this scope in this browser? New on-chain items can appear again after future activity.",
    );
    if (!confirmed) return;

    setPortfolioHideAllPending(storageScope, true);
    setPackageMessage("Current scope hidden locally. On-chain data was not deleted.");
  }

  function onClearCurrentScopeCache() {
    const confirmed = window.confirm(
      "Clear local cache, hidden IDs and pending UI flags for the current scope only?",
    );
    if (!confirmed) return;

    clearScopeUiState(storageScope);
    setPackageMessage("Current scope cache cleared locally.");
  }

  function onStartCleanSession() {
    const nextPackageId = normalizeIotaObjectIdValue(packageInput);
    const nextNotarizationPackageId = normalizeIotaObjectIdValue(notarizationPackageInput);
    if (!nextPackageId) {
      setPackageMessage("Enter an already deployed package ID.");
      return;
    }

    if (nextPackageId !== envPackageId && !nextNotarizationPackageId) {
      setPackageMessage("Enter the matching notarization package ID for a custom deploy.");
      return;
    }

    const usingEnvPair =
      nextPackageId === envPackageId &&
      (!nextNotarizationPackageId || nextNotarizationPackageId === envNotarizationPackageId);
    const nextEffectiveNotarizationPackageId =
      nextNotarizationPackageId || envNotarizationPackageId || "";

    if (
      nextPackageId === packageId &&
      nextEffectiveNotarizationPackageId === (notarizationPackageId || "")
    ) {
      setPackageMessage("That package pair is already active.");
      return;
    }

    const confirmed = window.confirm(
      "Start a clean MVP session on the selected deployed package? This resets local UI/cache for the current and target scopes, but does not delete on-chain history.",
    );
    if (!confirmed) return;

    clearScopeUiState(storageScope);
    clearScopeUiState({
      network,
      packageId: nextPackageId,
    });

    if (usingEnvPair) {
      clearPackageOverride(network);
    } else {
      savePackageOverride(network, nextPackageId, nextEffectiveNotarizationPackageId);
    }

    setPackageMessage(`Active package pair switched to ${nextPackageId}.`);
    setResetOpen(false);
  }

  function onUseEnvPackage() {
    if (!envPackageId) {
      setPackageMessage("No environment package is configured for this network.");
      return;
    }

    if (!hasPackageOverride && !hasNotarizationPackageOverride) {
      setPackageMessage("Environment package pair is already active.");
      return;
    }

    const confirmed = window.confirm(
      "Revert to the environment package for this network? Local UI/cache for the current override scope will be cleared.",
    );
    if (!confirmed) return;

    clearScopeUiState(storageScope);
    clearPackageOverride(network);
    setPackageInput(envPackageId);
    setNotarizationPackageInput(envNotarizationPackageId);
    setPackageMessage("Environment package pair restored.");
  }

  function onLifecycleModeChange(nextMode: LifecycleMode) {
    setLifecycleMode(nextMode);
    saveLifecycleMode(nextMode);
  }

  async function onCopyPackageId() {
    if (!packageId) return;

    try {
      await navigator.clipboard.writeText(packageId);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = packageId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    window.localStorage.setItem("invoicevault.lastCopiedPackageId", packageId);
    setCopiedPackage(true);
    window.setTimeout(() => setCopiedPackage(false), 1200);
  }

  return (
    <div className="relative z-40" ref={containerRef}>
      <button
        className="btn-ghost h-9 rounded-[13px] px-3.5"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">
            Session Control
          </span>
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 max-h-[min(42rem,calc(100vh-5.5rem))] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,rgba(7,12,23,0.98),rgba(5,9,18,0.96))] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
          <div className="mb-3 rounded-[22px] border border-cyan-300/18 bg-[linear-gradient(145deg,rgba(10,19,35,0.92),rgba(7,12,24,0.88))] p-4">
            <p className="eyebrow">Session Orchestration</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Manage deploy pairing, treasury visibility and local browser state without
              mutating on-chain history.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="chip border-white/10 bg-white/4 text-slate-200">{network}</span>
              <span className="chip border-white/10 bg-white/4 text-slate-200">
                {scopeLabel}
              </span>
              <span className="chip border-cyan-300/22 bg-cyan-500/10 text-cyan-100">
                {packageId ? "On-chain active" : "Local demo"}
              </span>
              {hasPackageOverride || hasNotarizationPackageOverride ? (
                <span className="chip border-amber-300/25 bg-amber-500/10 text-amber-100">
                  Override pair
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {packageId ? (
                <button
                  className="rounded-xl border border-white/14 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                  onClick={onCopyPackageId}
                  title={packageId}
                >
                  {copiedPackage ? "Copied" : "Copy scope"}
                </button>
              ) : null}
              {activePackageExplorerUrl ? (
                <Link
                  href={activePackageExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-cyan-300/18 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/16"
                >
                  Open in explorer
                </Link>
              ) : null}
            </div>
          </div>
          <div className="mb-3 rounded-[22px] border border-emerald-300/25 bg-emerald-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100">
              Lifecycle Mode
            </p>
            <select
              className="mt-3 w-full rounded-2xl border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-300/50"
              style={{ colorScheme: "dark" }}
              value={lifecycleMode}
              onChange={(event) =>
                onLifecycleModeChange(event.target.value as LifecycleMode)
              }
            >
              <option value="NORMAL">Normal</option>
              <option value="DEFAULT_SIMULATION">Default Simulation</option>
            </select>
            <p className="mt-2 text-xs text-slate-300">
              {lifecycleMode === "DEFAULT_SIMULATION"
                ? "Demo mode: FUNDED can go directly to DEFAULTED after due date."
                : "Production-like mode: original OPEN/FUNDED/REPAID flow."}
            </p>
          </div>
          <div className="mb-3 rounded-[22px] border border-cyan-300/25 bg-cyan-500/10 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100">
                Treasury
              </p>
              <button
                className="rounded-xl border border-white/14 px-3 py-1.5 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                onClick={() => void loadTreasuryBalance()}
                disabled={loadingTreasury}
              >
                {loadingTreasury ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-300">
              {TREASURY_ADDRESS}
            </p>
            <p className="mt-2 text-sm text-slate-200">
              Balance:{" "}
              <span className="font-semibold text-cyan-100">
                {loadingTreasury
                  ? "Loading..."
                  : treasuryBalance !== null
                    ? `IOTA ${treasuryBalance}`
                    : "N/A"}
              </span>
            </p>
            {treasuryError ? (
              <p className="mt-1 text-xs text-red-300">Failed to load balance.</p>
            ) : null}
          </div>
          <div className="mt-2 rounded-[22px] border border-red-300/18 bg-red-500/6 p-3">
            <button
              className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/10"
              onClick={() => setResetOpen((prev) => !prev)}
            >
              <span>Data / Reset</span>
              <span className="text-[11px] normal-case tracking-normal text-red-200/90">
                {resetOpen ? "Hide" : "Show"}
              </span>
            </button>
            {resetOpen ? (
              <div className="mt-2 space-y-3">
                <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                    New MVP Session
                  </p>
                  <p className="mt-1 text-[11px] text-slate-300">
                    Enter the deployed invoice package and its matching notarization package.
                    This is the only way to get a truly clean marketplace state for the MVP.
                    Uniqueness remains scoped per deploy.
                  </p>
                  <input
                    type="text"
                    value={packageInput}
                    onChange={(event) => setPackageInput(event.target.value)}
                    placeholder="0x..."
                    className="mt-3 w-full rounded-2xl border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/45"
                  />
                  <input
                    type="text"
                    value={notarizationPackageInput}
                    onChange={(event) => setNotarizationPackageInput(event.target.value)}
                    placeholder="Matching notarization package 0x..."
                    className="mt-3 w-full rounded-2xl border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/45"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-2xl border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/18"
                      onClick={onStartCleanSession}
                    >
                      Start clean MVP session
                    </button>
                    <button
                      className="rounded-2xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-40"
                      onClick={onUseEnvPackage}
                      disabled={
                        !envPackageId || (!hasPackageOverride && !hasNotarizationPackageOverride)
                      }
                    >
                      Use env package
                    </button>
                  </div>
                  {envPackageId ? (
                    <>
                      <p className="mt-2 break-all font-mono text-[11px] text-slate-400">
                        Env invoice package: {envPackageId}
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
                        Env notarization package: {envNotarizationPackageId || "Missing"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-amber-200">
                      No env package configured for {network}.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <button
                    className="block w-full rounded-2xl px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
                    onClick={onHideCurrentScopeItems}
                  >
                    Hide current scope items
                  </button>
                  <button
                    className="block w-full rounded-2xl px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
                    onClick={onClearCurrentScopeCache}
                  >
                    Clear current scope cache
                  </button>
                </div>
                {packageMessage ? (
                  <p className="px-3 text-[11px] text-cyan-100">{packageMessage}</p>
                ) : null}
                <p
                  className="w-full rounded-2xl border border-white/10 px-3 py-2 text-left text-[11px] text-slate-300"
                >
                  Local UI actions only. On-chain data, ratings and historical transactions are
                  not deleted from the old deploy.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
