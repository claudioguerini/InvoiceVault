"use client";

import { useIotaClient } from "@iota/dapp-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LifecycleMode,
  clearInvoices,
  loadLifecycleMode,
  saveLifecycleMode,
  setPortfolioHideAllPending,
} from "@/lib/invoice-store";
import { NANOS_PER_IOTA } from "@/lib/iota-amount";
import { useEffectivePackageId, useNetworkState } from "@/components/app-providers";

const TREASURY_ADDRESS =
  "0x777a042ce80d4aaa59d69741775247f5131587e6654c7bc975bda804cd03b06b";

export function SystemMenu() {
  const iotaClient = useIotaClient();
  const { network } = useNetworkState();
  const { packageId } = useEffectivePackageId();
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copiedPackage, setCopiedPackage] = useState(false);
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>("NORMAL");
  const [treasuryBalance, setTreasuryBalance] = useState<string | null>(null);
  const [loadingTreasury, setLoadingTreasury] = useState(false);
  const [treasuryError, setTreasuryError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadTreasuryBalance = useCallback(async () => {
    setLoadingTreasury(true);
    setTreasuryError("");
    try {
      const balance = await iotaClient.getBalance({ owner: TREASURY_ADDRESS });
      const nanos = Number(balance.totalBalance);
      if (!Number.isFinite(nanos)) {
        setTreasuryBalance("N/A");
      } else {
        const amountIota = nanos / NANOS_PER_IOTA;
        setTreasuryBalance(
          new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 6,
          }).format(amountIota),
        );
      }
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
    void loadTreasuryBalance();
  }, [open, network, loadTreasuryBalance]);

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

  function onResetPortfolio() {
    const confirmed = window.confirm(
      "Hide currently loaded portfolio items in this browser? New items will still appear.",
    );
    if (!confirmed) return;

    setPortfolioHideAllPending(true);
    clearInvoices();
    window.location.reload();
  }

  function onResetInvoices() {
    const confirmed = window.confirm(
      "Hide currently loaded marketplace items and clear local invoice cache? New items will still appear.",
    );
    if (!confirmed) return;

    setPortfolioHideAllPending(true);
    clearInvoices();
    window.location.reload();
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
    <div className="relative" ref={containerRef}>
      <button
        className="h-10 rounded-xl border border-cyan-300/20 bg-slate-950/60 px-4 text-sm font-semibold text-slate-100 transition hover:-translate-y-px hover:border-cyan-300/35 hover:bg-slate-900/75"
        onClick={() => setOpen((prev) => !prev)}
      >
        System Options
      </button>
      {open ? (
        <div className="absolute right-0 top-12 z-30 w-80 rounded-xl border border-white/15 bg-[rgba(9,12,24,0.97)] p-2 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
          <div className="mb-2 rounded-lg border border-cyan-300/25 bg-cyan-500/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100">
                On-chain
              </p>
              {packageId ? (
                <button
                  className="rounded-md border border-white/20 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
                  onClick={onCopyPackageId}
                  title={packageId}
                >
                  {copiedPackage ? "Copied" : "Copy package id"}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-slate-200">
              Environment:{" "}
              <span className="font-semibold text-cyan-100">{network}</span>
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {packageId ? "Package configured." : "Package ID missing."}
            </p>
            {packageId ? (
              <p className="mt-1 break-all font-mono text-[11px] text-slate-300">
                {packageId}
              </p>
            ) : null}
          </div>
          <div className="mb-2 rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100">
              Lifecycle Mode
            </p>
            <select
              className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-300/50"
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
          <div className="mb-2 rounded-lg border border-cyan-300/25 bg-cyan-500/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100">
                Treasury
              </p>
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10"
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
          <div className="mt-2 rounded-lg border border-red-300/20 bg-red-500/5 p-2">
            <button
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/10"
              onClick={() => setResetOpen((prev) => !prev)}
            >
              <span>Data / Reset</span>
              <span className="text-[11px] normal-case tracking-normal text-red-200/90">
                {resetOpen ? "Hide" : "Show"}
              </span>
            </button>
            {resetOpen ? (
              <div className="mt-2 space-y-1">
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
                  onClick={onResetPortfolio}
                >
                  Hide current portfolio items
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
                  onClick={onResetInvoices}
                >
                  Hide marketplace items + clear cache
                </button>
                <p className="px-3 pb-1 text-[11px] text-slate-300">
                  Local UI action only. On-chain data is not deleted.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
