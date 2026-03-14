"use client";

import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { NetworkControls } from "@/components/network-controls";
import { SystemMenu } from "@/components/system-menu";
import { useEffectivePackages } from "@/components/app-providers";
import {
  LIFECYCLE_MODE_EVENT,
  loadLifecycleMode,
  type LifecycleMode,
} from "@/lib/invoice-store";

const primaryRoutes = [
  {
    path: "/",
    href: "/",
    label: "Overview",
    kicker: "Product Overview",
    summary: "Launch invoice financing on IOTA from proof to funding in one premium surface.",
  },
  {
    path: "/create",
    href: "/create#launch-guide",
    label: "Launch New Invoice",
    kicker: "Create Rail",
    summary: "Hash the PDF, notarize the proof, and mint the receivable.",
  },
  {
    path: "/marketplace",
    href: "/marketplace",
    label: "Explore Marketplace",
    kicker: "Buyer View",
    summary: "Compare listed claims, scan yield, and fund the right opportunity faster.",
  },
  {
    path: "/portfolio",
    href: "/portfolio",
    label: "Open Portfolio",
    kicker: "Operating Book",
    summary: "Track exposure, repayment and recovery from one operating book.",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const pathname = usePathname();
  const router = useRouter();
  const { packageId, network } = useEffectivePackages();
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>(() => loadLifecycleMode());
  const accountOnSelectedNetwork = account?.chains?.some((chain) =>
    chain.toLowerCase().includes(network.toLowerCase()),
  );
  const lifecycleLabel =
    lifecycleMode === "DEFAULT_SIMULATION" ? "Demo mode" : "Normal flow";
  const lifecycleIndicatorClass =
    lifecycleMode === "DEFAULT_SIMULATION"
      ? "border-amber-300/24 bg-amber-500/10 text-amber-100"
      : "border-emerald-300/22 bg-emerald-500/10 text-emerald-100";
  const lifecycleDotClass =
    lifecycleMode === "DEFAULT_SIMULATION" ? "bg-amber-300" : "bg-emerald-300";

  useEffect(() => {
    if (pathname === "/create" && window.location.hash === "#launch-guide") {
      const frame = window.requestAnimationFrame(() => {
        document.getElementById("launch-guide")?.scrollIntoView({ block: "start" });
      });

      return () => window.cancelAnimationFrame(frame);
    }

    if (pathname !== "/create") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (window.location.hash) {
        window.history.replaceState(window.history.state, "", pathname);
      }
    }
  }, [pathname]);

  useEffect(() => {
    function syncLifecycleMode() {
      setLifecycleMode(loadLifecycleMode());
    }

    syncLifecycleMode();
    window.addEventListener(LIFECYCLE_MODE_EVENT, syncLifecycleMode);
    window.addEventListener("storage", syncLifecycleMode);

    return () => {
      window.removeEventListener(LIFECYCLE_MODE_EVENT, syncLifecycleMode);
      window.removeEventListener("storage", syncLifecycleMode);
    };
  }, []);

  function onPrimaryRouteClick(
    event: MouseEvent<HTMLAnchorElement>,
    routePath: string,
    routeHref: string,
  ) {
    event.preventDefault();

    if (routePath === "/create") {
      if (pathname === "/create") {
        window.history.replaceState(window.history.state, "", routeHref);
        document.getElementById("launch-guide")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        return;
      }

      router.push(routeHref, { scroll: false });
      return;
    }

    if (pathname === routePath) {
      window.history.replaceState(window.history.state, "", routePath);
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return;
    }

    router.push(routePath, { scroll: true });
  }

  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top,rgba(105,231,255,0.18),transparent_55%)]" />
        <div className="absolute left-1/2 top-[16rem] h-px w-[min(100%,76rem)] -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:88px_88px] opacity-[0.08]" />
      </div>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(4,8,18,0.78)] backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6 sm:py-2.5">
          <div className="glass-strip overflow-visible px-3 py-2 sm:px-4 sm:py-2.5">
            <div className="flex flex-col gap-2">
              <div className="topbar-main">
                <div className="header-brand-lockup flex min-w-0 items-center">
                  <Link href="/" className="min-w-0">
                    <Image
                      src="/invoicevault-logo-v3-tight.png"
                      alt="InvoiceVault"
                      width={1120}
                      height={147}
                      priority
                      className="h-auto w-[170px] sm:w-[198px] lg:w-[228px]"
                    />
                  </Link>
                </div>
                <div className="topbar-action-cluster">
                  <NetworkControls />
                  <div
                    className={`flex h-9 items-center gap-2 rounded-[13px] border px-3 ${lifecycleIndicatorClass}`}
                    title={`Lifecycle mode: ${lifecycleLabel}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${lifecycleDotClass}`} />
                    <span className="text-sm font-semibold tracking-[0.01em]">
                      {lifecycleLabel}
                    </span>
                  </div>
                  <SystemMenu />
                  <div className="wallet-shell rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,17,32,0.95),rgba(7,13,25,0.9))] p-1 shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
                    <ConnectButton size="md" />
                  </div>
                </div>
              </div>
              <div className="route-tab-rail route-tab-rail-compact">
                <nav className="route-tabs route-tabs-compact" aria-label="Primary navigation">
                  {primaryRoutes.map((route) => {
                    const isActive = pathname === route.path;

                    return (
                      <Link
                        key={route.path}
                        className={isActive ? "route-tab route-tab-active" : "route-tab"}
                        href={route.href}
                        onClick={(event) =>
                          onPrimaryRouteClick(event, route.path, route.href)
                        }
                        aria-current={isActive ? "page" : undefined}
                      >
                        <span className="route-tab-kicker">{route.kicker}</span>
                        <span className="route-tab-title">{route.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </div>
          </div>
        </div>
        {!packageId ? (
          <div className="border-t border-red-400/30 bg-[linear-gradient(90deg,rgba(127,29,29,0.3),rgba(239,68,68,0.14),rgba(127,29,29,0.2))] px-6 py-2 text-center text-xs text-red-100">
            On-chain disabled on {network}: package ID missing. Transactions will fall back
            to local demo mode.
          </div>
        ) : null}
        {packageId && account && !accountOnSelectedNetwork ? (
          <div className="border-t border-amber-400/30 bg-[linear-gradient(90deg,rgba(120,53,15,0.3),rgba(245,158,11,0.16),rgba(120,53,15,0.22))] px-6 py-2 text-center text-xs text-amber-100">
            Wallet network mismatch: selected network is {network}. Switch wallet to{" "}
            {network} to sign on-chain transactions.
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
