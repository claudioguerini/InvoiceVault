"use client";

import {
  useCurrentAccount,
  useIotaClient,
  useSignAndExecuteTransaction,
} from "@iota/dapp-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEffectivePackageId } from "@/components/app-providers";
import { QuickAccessStrip } from "@/components/quick-access-strip";
import { useScopedInvoices } from "@/hooks/use-scoped-invoices";
import { buildObjectExplorerUrl, buildTxExplorerUrl } from "@/lib/explorer";
import {
  buildSellerRatings,
  sellerRatingsKey,
} from "@/lib/invoice-analytics";
import {
  normalizeIotaAddressValue,
  sameIotaAddress,
} from "@/lib/iota-ids";
import {
  type InvoiceRecord,
  canWalletFund,
  upsertInvoice,
} from "@/lib/invoice-store";
import {
  compareNanos,
  computeYieldPct,
  formatIota,
  iotaToNanos,
  nanosToIotaInput,
  parseIotaInput,
} from "@/lib/iota-amount";
import { waitForSuccessfulTransaction } from "@/lib/iota-execution";
import { buildCancelTx, buildFundTx, buildListForFundingTx } from "@/lib/iota-tx";

type StatusFilter = "ALL" | "LISTED" | "UNLISTED";
type SortOption =
  | "yield-desc"
  | "yield-asc"
  | "due-asc"
  | "due-desc"
  | "rating-desc";
type MessageTone = "success" | "error" | "info";

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function shallowEqualStringMap(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }

  return true;
}

function formatDueDate(epochSec: number) {
  return dueDateFormatter.format(new Date(epochSec * 1000));
}

export default function MarketplacePage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId, network } = useEffectivePackageId();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const {
    error,
    isFetching,
    isLoading,
    records,
    scope: storageScope,
  } = useScopedInvoices();

  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({});
  const [discountErrors, setDiscountErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [messageItemId, setMessageItemId] = useState<string | null>(null);
  const [openAuditItemId, setOpenAuditItemId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("yield-desc");
  const [sellerModal, setSellerModal] = useState<
    { key: string; displayAddress: string } | null
  >(null);
  const closeSellerModalRef = useRef<HTMLButtonElement | null>(null);
  const accountAddress = normalizeIotaAddressValue(account?.address);
  const sellerRatings = useMemo(() => buildSellerRatings(records), [records]);
  const canFund = canWalletFund(accountAddress);

  const openRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          item.status !== "REPAID" &&
          item.status !== "CANCELLED" &&
          item.status !== "DEFAULTED" &&
          item.status !== "RECOVERED",
      ),
    [records],
  );

  useEffect(() => {
    setDiscountInputs((previous) => {
      const next: Record<string, string> = {};

      openRecords.forEach((item) => {
        next[item.id] =
          previous[item.id] ??
          (item.discountPriceNanos ? nanosToIotaInput(item.discountPriceNanos) : "");
      });

      return shallowEqualStringMap(previous, next) ? previous : next;
    });

    setDiscountErrors((previous) => {
      const next: Record<string, string> = {};

      openRecords.forEach((item) => {
        next[item.id] = previous[item.id] ?? "";
      });

      return shallowEqualStringMap(previous, next) ? previous : next;
    });
  }, [openRecords]);

  useEffect(() => {
    if (!sellerModal) return;

    closeSellerModalRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSellerModal(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sellerModal]);

  function getUiStatus(item: InvoiceRecord): "UNLISTED" | "LISTED" | InvoiceRecord["status"] {
    if (item.status === "OPEN") {
      return item.discountPriceNanos ? "LISTED" : "UNLISTED";
    }
    return item.status;
  }

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const next = openRecords.filter((item) => {
      const uiStatus = getUiStatus(item);

      if (statusFilter === "LISTED" && uiStatus !== "LISTED") return false;
      if (statusFilter === "UNLISTED" && uiStatus !== "UNLISTED") return false;

      if (!normalizedSearch) return true;

      return (
        item.id.toLowerCase().includes(normalizedSearch) ||
        item.issuer.toLowerCase().includes(normalizedSearch)
      );
    });

    next.sort((left, right) => {
      if (sortBy === "yield-asc" || sortBy === "yield-desc") {
        const leftValue = computeYieldPct(left.amountNanos, left.discountPriceNanos) ?? -Infinity;
        const rightValue =
          computeYieldPct(right.amountNanos, right.discountPriceNanos) ?? -Infinity;
        return sortBy === "yield-desc" ? rightValue - leftValue : leftValue - rightValue;
      }

      if (sortBy === "due-asc" || sortBy === "due-desc") {
        return sortBy === "due-asc"
          ? left.dueDateEpochSec - right.dueDateEpochSec
          : right.dueDateEpochSec - left.dueDateEpochSec;
      }

      const leftRating = sellerRatings.get(sellerRatingsKey(left.issuer))?.avg ?? 0;
      const rightRating = sellerRatings.get(sellerRatingsKey(right.issuer))?.avg ?? 0;
      return rightRating - leftRating;
    });

    return next;
  }, [openRecords, search, sellerRatings, sortBy, statusFilter]);

  const marketplaceMetrics = useMemo(() => {
    const listedRecords = openRecords.filter((item) => getUiStatus(item) === "LISTED");
    const yields = listedRecords
      .map((item) => computeYieldPct(item.amountNanos, item.discountPriceNanos))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const bestYield = yields.length > 0 ? `${Math.max(...yields).toFixed(2)}%` : "N/A";
    const nearestDue =
      openRecords.length > 0
        ? formatDueDate(
            openRecords.reduce(
              (soonest, item) => Math.min(soonest, item.dueDateEpochSec),
              Number.POSITIVE_INFINITY,
            ),
          )
        : "No open claims";
    const ratedSellerCount = new Set(
      openRecords
        .filter((item) => (sellerRatings.get(sellerRatingsKey(item.issuer))?.count ?? 0) > 0)
        .map((item) => sellerRatingsKey(item.issuer)),
    ).size;

    return [
      {
        label: "Open Claims",
        value: openRecords.length.toString(),
        caption: "Visible opportunities before repayment or cancellation.",
      },
      {
        label: "Listed Now",
        value: listedRecords.length.toString(),
        caption: "Claims currently carrying a market entry price.",
      },
      {
        label: "Best Yield",
        value: bestYield,
        caption: "Highest visible spread among listed claims.",
      },
      {
        label: "Rated Sellers",
        value: ratedSellerCount.toString(),
        caption: `Nearest due date: ${nearestDue}`,
      },
    ];
  }, [openRecords, sellerRatings]);

  const listedVisibleCount = useMemo(
    () => filteredRecords.filter((item) => getUiStatus(item) === "LISTED").length,
    [filteredRecords],
  );

  const ratedVisibleSellerCount = useMemo(
    () =>
      new Set(
        filteredRecords
          .filter((item) => (sellerRatings.get(sellerRatingsKey(item.issuer))?.count ?? 0) > 0)
          .map((item) => sellerRatingsKey(item.issuer)),
      ).size,
    [filteredRecords, sellerRatings],
  );

  function shortenId(value: string) {
    if (value.length <= 16) return value;
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  }

  function shortenAddress(value: string) {
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function auditEntries(item: InvoiceRecord) {
    return [
      ["Notarization", item.notarizationId, "object"],
      ["Notarization Tx", item.notarizationDigest, "tx"],
      ["Create Tx", item.createDigest, "tx"],
      ["List Tx", item.listDigest, "tx"],
      ["Fund Tx", item.fundDigest, "tx"],
      ["Cancel Tx", item.cancelDigest, "tx"],
      ["Default Tx", item.defaultDigest, "tx"],
      ["Repay Tx", item.repayDigest, "tx"],
      ["Rate Tx", item.rateDigest, "tx"],
    ] as const;
  }

  function showCardMessage(itemId: string, text: string, tone: MessageTone) {
    setMessage(text);
    setMessageTone(tone);
    setMessageItemId(itemId);
  }

  async function onCopyInvoiceId(id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(id);
      showCardMessage(id, `Invoice ID copied: ${id}`, "info");
    } catch {
      showCardMessage(id, "Unable to copy invoice ID.", "error");
    }
  }

  async function onListForFunding(item: InvoiceRecord, discountPriceNanos: bigint) {
    if (!accountAddress) return;
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);

    try {
      let listDigest: string | undefined;

      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildListForFundingTx(targetPackageId, item.id, discountPriceNanos);
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Listing update",
        });
        listDigest = result.digest;
        showCardMessage(
          item.id,
          `Listed invoice ${item.id} (${result.digest}).`,
          "success",
        );
      } else {
        showCardMessage(item.id, `Listed invoice ${item.id} (local demo mode).`, "success");
      }

      upsertInvoice(storageScope, {
        ...item,
        discountPriceNanos: discountPriceNanos.toString(),
        listDigest: listDigest ?? item.listDigest,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      showCardMessage(item.id, `list_for_funding failed: ${errorMessage}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function onFund(item: InvoiceRecord) {
    if (!accountAddress || !canWalletFund(accountAddress)) return;
    if (item.status !== "OPEN") return;
    if (!item.discountPriceNanos) return;
    if (sameIotaAddress(item.issuer, accountAddress)) return;
    const targetPackageId = item.packageId || packageId;

    setBusyId(item.id);
    try {
      const fundedAtMs = Date.now();
      const isSimulation = item.lifecycleMode === "DEFAULT_SIMULATION";
      const simulationDueDate = Math.floor(fundedAtMs / 1000) + 30;
      let fundDigest: string | undefined;

      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildFundTx(targetPackageId, item.id, item.discountPriceNanos);
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Invoice funding",
        });
        fundDigest = result.digest;
        showCardMessage(
          item.id,
          `Funded invoice ${item.id} (${result.digest}).`,
          "success",
        );
      } else {
        showCardMessage(item.id, `Funded invoice ${item.id} (local demo mode).`, "success");
      }

      upsertInvoice(storageScope, {
        ...item,
        status: "FUNDED",
        holder: accountAddress,
        fundedAtMs,
        dueDateEpochSec: isSimulation ? simulationDueDate : item.dueDateEpochSec,
        fundDigest: fundDigest ?? item.fundDigest,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      showCardMessage(item.id, `fund_invoice failed: ${errorMessage}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function onCancel(item: InvoiceRecord) {
    if (!accountAddress || !sameIotaAddress(item.issuer, accountAddress)) return;
    if (item.status !== "OPEN") return;

    const confirmed = window.confirm(
      "Cancel this invoice listing? The action remains visible on-chain for the active deploy.",
    );
    if (!confirmed) return;

    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);

    try {
      let cancelDigest: string | undefined;

      if (targetPackageId && !item.id.startsWith("local-")) {
        if (!item.registryId) {
          throw new Error("Registry ID missing for the selected invoice.");
        }

        const tx = buildCancelTx(targetPackageId, item.registryId, item.id);
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Invoice cancellation",
        });
        cancelDigest = result.digest;
        showCardMessage(
          item.id,
          `Cancelled invoice ${item.id} (${result.digest}).`,
          "success",
        );
      } else {
        showCardMessage(item.id, `Cancelled invoice ${item.id} (local demo mode).`, "success");
      }

      upsertInvoice(storageScope, {
        ...item,
        status: "CANCELLED",
        discountPriceNanos: null,
        cancelDigest: cancelDigest ?? item.cancelDigest,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      showCardMessage(item.id, `cancel_invoice failed: ${errorMessage}`, "error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="space-y-5">
      <div className="panel space-y-4 px-5 py-5 sm:px-6">
        <QuickAccessStrip
          summary="Skip the overview and jump straight to the live marketplace surface: the highlights, the filter bar or the opportunity tape."
          items={[
            {
              href: "#market-listings",
              kicker: "Go live",
              title: "Open opportunities",
              detail: "Land directly on the current invoice rows and act from the tape.",
              badge: `${filteredRecords.length} live`,
              emphasis: filteredRecords.length > 0,
            },
            {
              href: "#market-filters",
              kicker: "Refine",
              title: "Search and filters",
              detail: "Narrow by invoice, seller, status, yield or due date before scanning.",
              badge: `${listedVisibleCount} listed`,
            },
            {
              href: "#market-highlights",
              kicker: "Snapshot",
              title: "Market highlights",
              detail: "Check best visible yield and seller depth before drilling into rows.",
              badge: marketplaceMetrics[2]?.value ?? "N/A",
            },
          ]}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div>
            <p className="eyebrow">Funding Arena</p>
            <h1 className="mt-2 text-[clamp(2rem,4vw,3.2rem)] font-semibold tracking-[-0.06em] text-white">
              Filter quickly, then act on the first good claim.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Use search, status and sort to narrow the tape, then open a listed claim below to
              fund it or set a market price if you are the seller.
            </p>
          </div>

          <div id="market-highlights" className="grid scroll-mt-40 gap-3 sm:grid-cols-2">
            {marketplaceMetrics.map((metric) => (
              <div key={metric.label} className="metric-card px-4 py-4">
                <p className="metric-label">{metric.label}</p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  {metric.value}
                </p>
                <p className="metric-caption mt-2">{metric.caption}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/4 px-4 py-4">
          <p className="metric-label">Operator Guide</p>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Start with `Listed` if you want immediate buy candidates. Sort by yield or due date
            to surface priority first, then use the action panel inside each row.
          </p>
        </div>

        {!canFund ? (
          <div className="rounded-[22px] border border-amber-300/24 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Wallet not eligible to buy (allowlist/denylist rule).
          </div>
        ) : null}

        <div
          id="market-filters"
          className="grid scroll-mt-40 gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end"
        >
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Search
            </span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Invoice ID or seller"
              className="h-12 w-full rounded-[18px] border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-4 text-sm text-slate-100 outline-none transition focus:border-cyan-300/45"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-12 rounded-[18px] border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-4 text-sm text-slate-100 outline-none transition focus:border-cyan-300/45"
              style={{ colorScheme: "dark" }}
            >
              <option value="ALL">All Open</option>
              <option value="LISTED">Listed</option>
              <option value="UNLISTED">Unlisted</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Sort
            </span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortOption)}
              className="h-12 rounded-[18px] border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-4 text-sm text-slate-100 outline-none transition focus:border-cyan-300/45"
              style={{ colorScheme: "dark" }}
            >
              <option value="yield-desc">Yield high to low</option>
              <option value="yield-asc">Yield low to high</option>
              <option value="due-asc">Due date soonest</option>
              <option value="due-desc">Due date latest</option>
              <option value="rating-desc">Seller rating</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 pt-1 text-xs text-slate-300 lg:col-span-full">
            <span className="chip border-white/10 bg-white/4 text-slate-200">
              Visible: {filteredRecords.length}
            </span>
            <span className="chip border-white/10 bg-white/4 text-slate-200">
              Listed: {listedVisibleCount}
            </span>
            <span className="chip border-white/10 bg-white/4 text-slate-200">
              Sellers with ratings: {ratedVisibleSellerCount}
            </span>
          </div>
        </div>
      </div>

      <div id="market-listings" className="grid scroll-mt-40 gap-4" aria-busy={isFetching}>
        {isLoading ? (
          <div className="panel px-5 py-5 text-slate-300">Loading marketplace invoices...</div>
        ) : null}
        {!isLoading && error ? (
          <div className="panel px-5 py-5 text-red-200">
            Unable to load marketplace data. {error instanceof Error ? error.message : ""}
          </div>
        ) : null}
        {!isLoading && !error && filteredRecords.length === 0 ? (
          <div className="panel px-5 py-5 text-slate-300">
            No invoices available for the current filters.
          </div>
        ) : null}

        {filteredRecords.map((item) => {
          const uiStatus = getUiStatus(item);
          const isListed = uiStatus === "LISTED";
          const ratingStats = sellerRatings.get(sellerRatingsKey(item.issuer));
          const isCurrentUserIssuer = sameIotaAddress(item.issuer, accountAddress);
          const auditItems = auditEntries(item).filter(([, value]) => Boolean(value));
          const auditEntryCount = auditItems.length + (item.notarizationCreatedAtMs ? 1 : 0);
          const yieldPct = computeYieldPct(item.amountNanos, item.discountPriceNanos);
          const spreadNanos = item.discountPriceNanos
            ? BigInt(item.amountNanos) - BigInt(item.discountPriceNanos)
            : null;
          const buyPriceLabel = item.discountPriceNanos
            ? `IOTA ${formatIota(item.discountPriceNanos)}`
            : "Not listed";
          const dueDateLabel = formatDueDate(item.dueDateEpochSec);
          const yieldLabel =
            yieldPct === null ? "N/A" : `${yieldPct >= 0 ? "+" : ""}${yieldPct.toFixed(2)}%`;
          const sellerLabel = shortenAddress(item.issuer);
          const invoiceExplorerUrl = item.id.startsWith("local-")
            ? null
            : buildObjectExplorerUrl(item.id, network);
          const marketNarrative = isCurrentUserIssuer
            ? "Seller mode: set a sharper entry price and keep the claim competitive."
            : isListed
              ? "Buyer-ready: compare seller quality, timing and spread before funding."
              : "Open but not listed yet: no buyer entry until the seller sets a price.";

          return (
            <div key={item.id} className="space-y-2">
              <article className="panel panel-interactive px-4 py-4 sm:px-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Invoice</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {invoiceExplorerUrl ? (
                          <a
                            href={invoiceExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-sm text-slate-200 transition hover:text-cyan-100"
                            title="Open invoice object in explorer"
                          >
                            {shortenId(item.id)}
                          </a>
                        ) : (
                          <p className="font-mono text-sm text-slate-200" title={item.id}>
                            {shortenId(item.id)}
                          </p>
                        )}
                        <button
                          type="button"
                          className="rounded-xl border border-white/12 px-3 py-1 text-[11px] text-slate-300 transition hover:border-cyan-300/50 hover:text-cyan-100"
                          onClick={() => void onCopyInvoiceId(item.id)}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-400">Seller:</span>
                        <button
                          type="button"
                          className="rounded-xl border border-white/12 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
                          onClick={() =>
                            setSellerModal({
                              key: sellerRatingsKey(item.issuer),
                              displayAddress: item.issuer,
                            })
                          }
                        >
                          {ratingStats
                            ? `${sellerLabel} | ${ratingStats.avg.toFixed(1)}/5 (${ratingStats.count})`
                            : `${sellerLabel} | No ratings`}
                        </button>
                        {isCurrentUserIssuer ? (
                          <span className="chip border-cyan-300/24 bg-cyan-500/10 text-cyan-100">
                            You are the seller
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {auditEntryCount > 0 ? (
                        <button
                          type="button"
                          aria-expanded={openAuditItemId === item.id}
                          className={
                            openAuditItemId === item.id
                              ? "chip border-cyan-300/30 bg-cyan-500/12 text-cyan-100"
                              : "chip border-white/12 bg-white/5 text-slate-100"
                          }
                          onClick={() =>
                            setOpenAuditItemId((previous) =>
                              previous === item.id ? null : item.id,
                            )
                          }
                        >
                          Audit {auditEntryCount}
                        </button>
                      ) : null}
                      <span
                        className={
                          uiStatus === "LISTED"
                            ? "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                            : uiStatus === "UNLISTED"
                              ? "chip border-slate-300/25 bg-slate-700/25 text-slate-100"
                              : "chip"
                        }
                      >
                        {uiStatus}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="field-shell rounded-[18px] px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Face Value
                      </p>
                      <p className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-white">
                        IOTA {formatIota(item.amountNanos)}
                      </p>
                    </div>
                    <div className="field-shell rounded-[18px] border border-cyan-300/24 bg-[linear-gradient(180deg,rgba(16,45,66,0.48),rgba(8,21,37,0.4))] px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Buy Price
                      </p>
                      <p className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-cyan-50">
                        {buyPriceLabel}
                      </p>
                    </div>
                    <div className="field-shell rounded-[18px] px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Due Date
                      </p>
                      <p className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-white">
                        {dueDateLabel}
                      </p>
                    </div>
                  </div>

                  {auditEntryCount > 0 && openAuditItemId === item.id ? (
                    <div className="rounded-[16px] border border-white/10 bg-slate-950/18">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          On-chain trail
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.notarizationCreatedAtMs ? (
                            <span className="chip border-white/10 bg-white/4 text-slate-200">
                              Notarized {new Date(item.notarizationCreatedAtMs).toLocaleString()}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-xl border border-white/12 px-3 py-1 text-[11px] text-slate-300 transition hover:border-cyan-300/50 hover:text-cyan-100"
                            onClick={() => setOpenAuditItemId(null)}
                          >
                            Hide
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        {auditItems.map(([label, value, type]) => (
                          <a
                            key={label}
                            href={
                              type === "object"
                                ? buildObjectExplorerUrl(value, network)
                                : buildTxExplorerUrl(value, network)
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-[14px] border border-white/10 bg-slate-950/35 px-3 py-2.5 transition hover:border-cyan-300/30 hover:bg-slate-950/55"
                          >
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                              {label}
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-200">
                              {shortenId(value)}
                            </p>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15.5rem] lg:items-stretch">
                    <div className="rounded-[18px] border border-white/10 bg-white/4 px-3 py-3">
                      {isCurrentUserIssuer && item.status === "OPEN" ? (
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_10.75rem_9.5rem] lg:items-center">
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={discountInputs[item.id] ?? ""}
                              placeholder="Buy price in IOTA"
                              onChange={(event) => {
                                const rawValue = event.target.value;
                                const normalized = rawValue.replace(",", ".");
                                const digitsAndDotsOnly = normalized.replace(/[^0-9.]/g, "");
                                const firstDotIndex = digitsAndDotsOnly.indexOf(".");
                                const nextValue =
                                  firstDotIndex === -1
                                    ? digitsAndDotsOnly
                                    : `${digitsAndDotsOnly.slice(0, firstDotIndex + 1)}${digitsAndDotsOnly
                                        .slice(firstDotIndex + 1)
                                        .replace(/\./g, "")}`;

                                setDiscountInputs((prev) => ({
                                  ...prev,
                                  [item.id]: nextValue,
                                }));

                                if (discountErrors[item.id]) {
                                  setDiscountErrors((prev) => ({
                                    ...prev,
                                    [item.id]: "",
                                  }));
                                }
                              }}
                              onBlur={() => {
                                const current = discountInputs[item.id] ?? "";
                                if (!current) return;
                                const parsedIota = parseIotaInput(current);
                                if (!parsedIota) return;
                                const parsedNanos = iotaToNanos(parsedIota);
                                if (compareNanos(parsedNanos, item.amountNanos) > 0) {
                                  setDiscountInputs((prev) => ({
                                    ...prev,
                                    [item.id]: "",
                                  }));
                                  setDiscountErrors((prev) => ({
                                    ...prev,
                                    [item.id]: "Buy Price > Face Value.",
                                  }));
                                }
                              }}
                              className={`h-12 w-full rounded-[16px] border bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-4 text-sm text-slate-100 placeholder:text-slate-500 ${
                                discountErrors[item.id] ? "border-red-400/70" : "border-white/12"
                              }`}
                            />
                            {discountErrors[item.id] ? (
                              <p className="text-xs text-red-300">{discountErrors[item.id]}</p>
                            ) : (
                              <p className="text-xs text-slate-400">
                                Set a sharper entry price and keep the claim competitive.
                              </p>
                            )}
                          </div>
                          <button
                            className="btn h-12 w-full px-4 text-sm"
                            onClick={() => {
                              const parsedIota = parseIotaInput(discountInputs[item.id] ?? "");
                              const parsedNanos = parsedIota ? iotaToNanos(parsedIota) : 0n;
                              if (parsedIota && compareNanos(parsedNanos, item.amountNanos) > 0) {
                                setDiscountInputs((prev) => ({
                                  ...prev,
                                  [item.id]: "",
                                }));
                                setDiscountErrors((prev) => ({
                                  ...prev,
                                  [item.id]: "Buy Price > Face Value.",
                                }));
                                return;
                              }
                              if (!parsedIota || parsedNanos <= 0n) {
                                setDiscountErrors((prev) => ({
                                  ...prev,
                                  [item.id]: "Enter a valid Buy Price.",
                                }));
                                showCardMessage(item.id, "Enter a valid Buy Price.", "error");
                                return;
                              }
                              setDiscountErrors((prev) => ({
                                ...prev,
                                [item.id]: "",
                              }));
                              void onListForFunding(item, parsedNanos);
                            }}
                            disabled={busyId === item.id}
                          >
                            list_for_funding
                          </button>
                          <button
                            className="btn-ghost h-12 w-full border-red-300/25 bg-red-500/10 px-4 text-sm text-red-100 hover:bg-red-500/20"
                            onClick={() => void onCancel(item)}
                            disabled={busyId === item.id}
                          >
                            cancel_invoice
                          </button>
                        </div>
                      ) : item.status === "OPEN" && !isCurrentUserIssuer && isListed ? (
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_10.5rem] lg:items-center">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-slate-200">
                              Buy at the listed price and inherit the repayment claim.
                            </p>
                            <p className="text-xs text-slate-400">
                              Seller quality and maturity stay visible before funding.
                            </p>
                          </div>
                          <button
                            className="btn h-12 w-full px-4 text-sm"
                            onClick={() => void onFund(item)}
                            disabled={busyId === item.id || !canFund}
                          >
                            fund_invoice
                          </button>
                        </div>
                      ) : (
                        <div className="flex min-h-[3rem] flex-wrap items-center justify-between gap-2">
                          <p className="text-sm leading-6 text-slate-300">{marketNarrative}</p>
                          <span
                            className={
                              isListed
                                ? "chip border-emerald-300/24 bg-emerald-500/10 text-emerald-100"
                                : "chip border-white/10 bg-white/5 text-slate-200"
                            }
                          >
                            {isListed ? "Funding ready" : "Awaiting seller price"}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-[22px] border border-cyan-300/24 bg-[linear-gradient(180deg,rgba(10,58,61,0.52),rgba(8,32,44,0.4))] px-4 py-4 lg:h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="eyebrow">Yield</p>
                          <p className="mt-2 text-[2rem] font-semibold tracking-[-0.05em] text-cyan-50">
                            {yieldLabel}
                          </p>
                        </div>
                        <span className="chip border-emerald-300/24 bg-emerald-500/10 text-emerald-100">
                          {yieldPct !== null && yieldPct > 0 ? "YIELD+" : "YIELD"}
                        </span>
                      </div>
                      <p className="mt-4 text-sm font-medium text-slate-100">
                        Buy {item.discountPriceNanos ? formatIota(item.discountPriceNanos) : "N/A"} -
                        Repay {formatIota(item.amountNanos)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-300">
                        {spreadNanos !== null ? `Spread IOTA ${formatIota(spreadNanos)}` : "Yield appears after listing"}.
                      </p>
                    </div>
                  </div>
                </div>
              </article>

              {messageItemId === item.id && message ? (
                <p
                  aria-live="polite"
                  className={
                    messageTone === "error"
                      ? "px-1 text-sm text-red-300"
                      : messageTone === "success"
                        ? "px-1 text-sm text-cyan-200"
                        : "px-1 text-sm text-slate-300"
                  }
                >
                  {message}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {sellerModal ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={() => setSellerModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="seller-ratings-title"
            className="w-full max-w-2xl rounded-[28px] border border-white/15 bg-[linear-gradient(180deg,rgba(9,12,24,0.99),rgba(6,10,20,0.97))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p id="seller-ratings-title" className="eyebrow">
                  Seller Ratings
                </p>
                <p className="mt-2 font-mono text-sm text-slate-200">
                  {sellerModal.displayAddress}
                </p>
              </div>
              <button
                ref={closeSellerModalRef}
                className="btn-ghost px-3 py-2 text-xs"
                onClick={() => setSellerModal(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {(sellerRatings.get(sellerModal.key)?.entries ?? []).length === 0 ? (
                <p className="rounded-[20px] border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                  No ratings available for this seller.
                </p>
              ) : (
                sellerRatings.get(sellerModal.key)?.entries.map((entry) => (
                  <div
                    key={`${entry.invoiceId}-${entry.score}`}
                    className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs text-slate-300" title={entry.invoiceId}>
                        {shortenId(entry.invoiceId)}
                      </p>
                      <div className="flex items-center gap-2">
                        {entry.status === "DEFAULTED" ||
                        entry.status === "RECOVERED" ||
                        entry.wasDefaulted ? (
                          <p
                            className={
                              entry.status === "DEFAULTED"
                                ? "chip border-red-300/35 bg-red-500/15 text-red-100"
                                : "chip border-violet-300/35 bg-violet-500/15 text-violet-100"
                            }
                          >
                            {entry.status === "DEFAULTED"
                              ? "DEFAULTED"
                              : "DEFAULTED/RECOVERED"}
                          </p>
                        ) : null}
                        <p className="text-sm font-semibold text-cyan-100">{entry.score}/5</p>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Face Value: IOTA {formatIota(entry.amountNanos)} | Due{" "}
                      {formatDueDate(entry.dueDateEpochSec)}
                      {entry.ratedBy ? ` | Rated by ${shortenAddress(entry.ratedBy)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

