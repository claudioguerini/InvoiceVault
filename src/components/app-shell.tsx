"use client";

import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NetworkControls } from "@/components/network-controls";
import { SystemMenu } from "@/components/system-menu";
import { useEffectivePackageId } from "@/components/app-providers";
import {
  LIFECYCLE_MODE_EVENT,
  LifecycleMode,
  loadLifecycleMode,
} from "@/lib/invoice-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const { packageId, network } = useEffectivePackageId();
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>("NORMAL");
  const accountOnSelectedNetwork = account?.chains?.some((chain) =>
    chain.toLowerCase().includes(network.toLowerCase()),
  );

  useEffect(() => {
    const syncMode = () => setLifecycleMode(loadLifecycleMode());
    syncMode();
    window.addEventListener("storage", syncMode);
    window.addEventListener(LIFECYCLE_MODE_EVENT, syncMode);
    return () => {
      window.removeEventListener("storage", syncMode);
      window.removeEventListener(LIFECYCLE_MODE_EVENT, syncMode);
    };
  }, []);

  const tabs = [
    { href: "/create", label: "Create" },
    { href: "/marketplace", label: "Marketplace" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(6,10,22,0.84)] backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-2">
          <div className="rounded-2xl border border-cyan-300/15 bg-[linear-gradient(120deg,rgba(10,16,34,0.92),rgba(7,13,29,0.94))] px-4 py-3 shadow-[0_12px_34px_rgba(0,0,0,0.26)]">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[220px]">
                <Link href="/" className="block">
                  <Image
                    src="/invoicevault-logo-v3-tight.png"
                    alt="InvoiceVault"
                    width={1120}
                    height={147}
                    unoptimized
                    priority
                    className="h-auto w-[240px] sm:w-[300px] lg:w-[360px]"
                  />
                </Link>
              </div>
              <div className="ml-auto min-w-0 flex-1 sm:flex-none sm:pl-4 lg:pl-12 xl:pl-16">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[linear-gradient(120deg,rgba(8,14,30,0.62),rgba(7,12,26,0.54))] px-2.5 py-1 shadow-[0_0_0_1px_rgba(56,189,248,0.06),0_12px_28px_rgba(2,6,23,0.36)]">
                  <NetworkControls />
                  <span
                    className={
                      lifecycleMode === "DEFAULT_SIMULATION"
                        ? "rounded-full border border-amber-300/30 bg-amber-500/12 px-2.5 py-1 text-xs font-semibold text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                        : "rounded-full border border-emerald-300/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.16)]"
                    }
                    title={
                      lifecycleMode === "DEFAULT_SIMULATION"
                        ? "Mode: Default Simulation"
                        : "Mode: Normal"
                    }
                  >
                    {lifecycleMode === "DEFAULT_SIMULATION"
                      ? "Mode: Demo"
                      : "Mode: Normal"}
                  </span>
                  <SystemMenu />
                </div>
              </div>
              <div className="shrink-0">
                <ConnectButton />
              </div>
            </div>

            <nav className="mt-4 inline-flex w-fit items-center gap-1 rounded-xl border border-white/10 bg-[linear-gradient(120deg,rgba(5,9,20,0.64),rgba(8,14,28,0.58))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              {tabs.map((tab) => {
                const active =
                  pathname === tab.href ||
                  (tab.href === "/create" && pathname === "/");

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={
                      active
                        ? "rounded-lg border border-cyan-200/50 bg-gradient-to-r from-cyan-400/32 to-emerald-300/26 px-4 py-2 text-[1.02rem] font-semibold text-white shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                        : "rounded-lg border border-transparent px-4 py-2 text-[1.02rem] font-semibold text-slate-300 transition hover:border-white/15 hover:bg-slate-900/60 hover:text-white"
                    }
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        {!packageId ? (
          <div className="border-t border-red-400/30 bg-red-500/15 px-6 py-1.5 text-center text-xs text-red-100">
            On-chain disabled on {network}: package ID missing. Transactions will fall back
            to local demo mode.
          </div>
        ) : null}
        {packageId && account && !accountOnSelectedNetwork ? (
          <div className="border-t border-amber-400/30 bg-amber-500/15 px-6 py-1.5 text-center text-xs text-amber-100">
            Wallet network mismatch: selected network is {network}. Switch wallet to{" "}
            {network} to sign on-chain transactions.
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
