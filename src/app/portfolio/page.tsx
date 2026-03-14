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
import { waitForSuccessfulTransaction } from "@/lib/iota-execution";
import {
  buildSellerRatings,
  computeAverageSellerRatingForRecords,
  sellerRatingsKey,
} from "@/lib/invoice-analytics";
import {
  normalizeIotaAddressValue,
  sameIotaAddress,
} from "@/lib/iota-ids";
import { formatIota } from "@/lib/iota-amount";
import {
  computeDefaultRepayAmount,
  type InvoiceRecord,
  upsertInvoice,
} from "@/lib/invoice-store";
import {
  buildCancelTx,
  buildMarkDefaultedTx,
  buildRateInvoiceTx,
  buildRepayTx,
} from "@/lib/iota-tx";

type RatingsModalState = {
  key: string;
  displayAddress: string;
  title: string;
} | null;

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDueDate(epochSec: number) {
  return dueDateFormatter.format(new Date(epochSec * 1000));
}

function shortenId(value: string) {
  return value.length <= 16 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function shortenAddress(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getUiStatus(item: InvoiceRecord): "UNLISTED" | "LISTED" | InvoiceRecord["status"] {
  return item.status === "OPEN" ? (item.discountPriceNanos ? "LISTED" : "UNLISTED") : item.status;
}

function isDueForDefault(item: InvoiceRecord, nowSec: number) {
  return item.dueDateEpochSec > 0 && nowSec > item.dueDateEpochSec;
}

function canRateInvoice(item: InvoiceRecord) {
  return item.status === "REPAID" || item.status === "RECOVERED";
}

function canOverrideDefaultRating(item: InvoiceRecord) {
  return item.status === "RECOVERED" && item.autoDefaultRating === true && (item.ratingScore ?? 0) > 0;
}

function isLivePortfolioPosition(item: InvoiceRecord) {
  return item.status === "OPEN" || item.status === "FUNDED" || item.status === "DEFAULTED";
}

function repayAmount(item: InvoiceRecord) {
  return item.status === "DEFAULTED"
    ? computeDefaultRepayAmount(item.amountNanos)
    : BigInt(item.amountNanos);
}

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId, network } = useEffectivePackageId();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { error, isFetching, isLoading, records, scope: storageScope } = useScopedInvoices();
  const [ratingInputs, setRatingInputs] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<RatingsModalState>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const closeModalRef = useRef<HTMLButtonElement | null>(null);
  const accountAddress = normalizeIotaAddressValue(account?.address);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modal) return;
    closeModalRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  const visibleRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          (sameIotaAddress(item.issuer, accountAddress) ||
            sameIotaAddress(item.holder, accountAddress)) &&
          item.status !== "CANCELLED",
      ),
    [records, accountAddress],
  );
  const issuerRecords = useMemo(
    () => visibleRecords.filter((item) => sameIotaAddress(item.issuer, accountAddress)),
    [visibleRecords, accountAddress],
  );
  const buyerRecords = useMemo(
    () => visibleRecords.filter((item) => sameIotaAddress(item.holder, accountAddress)),
    [visibleRecords, accountAddress],
  );

  const sellerRatings = useMemo(() => buildSellerRatings(records), [records]);

  const selfRatingStats = useMemo(() => {
    if (!accountAddress) return { avg: 0, count: 0 };
    return (
      sellerRatings.get(sellerRatingsKey(accountAddress)) ?? { avg: 0, count: 0, entries: [] }
    );
  }, [accountAddress, sellerRatings]);

  const buyerCounterpartyRatingStats = useMemo(
    () => computeAverageSellerRatingForRecords(buyerRecords, sellerRatings),
    [buyerRecords, sellerRatings],
  );

  const issuerKpis = useMemo(
    () => [
      ["Funded", issuerRecords.filter((item) => item.status === "FUNDED").length.toString()],
      [
        "Due Soon",
        issuerRecords
          .filter(
            (item) =>
              (item.status === "FUNDED" || item.status === "DEFAULTED") &&
              item.dueDateEpochSec >= nowSec &&
              item.dueDateEpochSec - nowSec <= 7 * 24 * 60 * 60,
          )
          .length.toString(),
      ],
      ["Repaid", issuerRecords.filter((item) => item.status === "REPAID").length.toString()],
      ["Recovered", issuerRecords.filter((item) => item.status === "RECOVERED").length.toString()],
    ],
    [issuerRecords, nowSec],
  );

  const buyerKpis = useMemo(
    () => [
      [
        "Active Exposure",
        `IOTA ${formatIota(
          buyerRecords
            .filter((item) => item.status === "FUNDED" || item.status === "DEFAULTED")
            .reduce((total, item) => total + BigInt(item.amountNanos), 0n),
        )}`,
      ],
      ["Repaid", buyerRecords.filter((item) => item.status === "REPAID").length.toString()],
      ["Recoveries", buyerRecords.filter((item) => item.status === "RECOVERED").length.toString()],
      [
        "Avg Counterparty Rating",
        buyerCounterpartyRatingStats.count > 0
          ? `${buyerCounterpartyRatingStats.avg.toFixed(1)}/5`
          : "N/A",
      ],
    ],
    [buyerCounterpartyRatingStats, buyerRecords],
  );

  const portfolioMetrics = useMemo(
    () => [
      [
        "Tracked Positions",
        visibleRecords.length.toString(),
        "Claims visible for the connected wallet on this scope.",
      ],
      ["Issuer Book", issuerRecords.length.toString(), "Invoices you originated."],
      ["Buyer Book", buyerRecords.length.toString(), "Claims you currently hold."],
      [
        "Stress Watch",
        visibleRecords
          .filter((item) => item.status === "DEFAULTED" || item.wasDefaulted)
          .length.toString(),
        "Defaulted or historically distressed positions.",
      ],
    ],
    [buyerRecords.length, issuerRecords.length, visibleRecords],
  );

  const issuerActionCount = useMemo(
    () =>
      issuerRecords.filter(
        (item) =>
          item.status === "OPEN" || item.status === "FUNDED" || item.status === "DEFAULTED",
      ).length,
    [issuerRecords],
  );

  const buyerActionCount = useMemo(
    () =>
      buyerRecords.filter(
        (item) =>
          (canRateInvoice(item) &&
            ((item.ratingScore ?? 0) === 0 || canOverrideDefaultRating(item))) ||
          (item.status === "FUNDED" &&
            item.lifecycleMode === "DEFAULT_SIMULATION" &&
            isDueForDefault(item, nowSec)),
      ).length,
    [buyerRecords, nowSec],
  );

  const issuerLiveCount = issuerRecords.filter(isLivePortfolioPosition).length;
  const buyerLiveCount = buyerRecords.filter(isLivePortfolioPosition).length;
  const issuerClosedCount = issuerRecords.length - issuerLiveCount;
  const buyerClosedCount = buyerRecords.length - buyerLiveCount;
  const sortedIssuerRecords = useMemo(
    () =>
      [...issuerRecords].sort(
        (left, right) =>
          Number(isLivePortfolioPosition(right)) - Number(isLivePortfolioPosition(left)) ||
          right.dueDateEpochSec - left.dueDateEpochSec,
      ),
    [issuerRecords],
  );
  const sortedBuyerRecords = useMemo(
    () =>
      [...buyerRecords].sort(
        (left, right) =>
          Number(isLivePortfolioPosition(right)) - Number(isLivePortfolioPosition(left)) ||
          right.dueDateEpochSec - left.dueDateEpochSec,
      ),
    [buyerRecords],
  );

  async function onRepay(item: InvoiceRecord) {
    if (!accountAddress || !sameIotaAddress(item.issuer, accountAddress)) return;
    if (item.status !== "FUNDED" && item.status !== "DEFAULTED") return;
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      let repayDigest: string | undefined;
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildRepayTx(targetPackageId, item.id, repayAmount(item));
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Invoice repayment",
        });
        repayDigest = result.digest;
        setMessage(item.status === "DEFAULTED" ? `Default recovered (${result.digest}).` : `Repayment sent (${result.digest}).`);
      } else {
        setMessage(item.status === "DEFAULTED" ? "Default recovered in local demo mode." : "Repayment marked in local demo mode.");
      }
      upsertInvoice(storageScope, {
        ...item,
        status: item.status === "DEFAULTED" ? "RECOVERED" : "REPAID",
        wasDefaulted: item.status === "DEFAULTED" ? true : item.wasDefaulted,
        recoveredAtMs: item.status === "DEFAULTED" ? Date.now() : item.recoveredAtMs ?? null,
        repayDigest: repayDigest ?? item.repayDigest,
      });
    } catch (error) {
      setMessage(`repay_invoice failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  async function onCancel(item: InvoiceRecord) {
    if (!accountAddress || !sameIotaAddress(item.issuer, accountAddress) || item.status !== "OPEN") {
      return;
    }
    if (!window.confirm("Cancel this invoice? This action remains visible on the active deploy.")) return;
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
        setMessage(`Invoice cancelled (${result.digest}).`);
      } else {
        setMessage("Invoice cancelled in local demo mode.");
      }
      upsertInvoice(storageScope, {
        ...item,
        status: "CANCELLED",
        discountPriceNanos: null,
        cancelDigest: cancelDigest ?? item.cancelDigest,
      });
    } catch (error) {
      setMessage(`cancel_invoice failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  async function onMarkDefaulted(item: InvoiceRecord) {
    if (!accountAddress || !sameIotaAddress(item.holder, accountAddress)) return;
    if (item.status !== "FUNDED" || item.lifecycleMode !== "DEFAULT_SIMULATION") return;
    if (!isDueForDefault(item, nowSec)) {
      setMessage("Invoice is not due for default yet.");
      return;
    }
    if (!window.confirm("Mark this invoice as defaulted? This also applies the auto-rating.")) return;
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      let defaultDigest: string | undefined;
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildMarkDefaultedTx(targetPackageId, item.id);
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Mark defaulted",
        });
        defaultDigest = result.digest;
        setMessage(`Invoice defaulted (${result.digest}).`);
      } else {
        setMessage("Invoice defaulted in local demo mode.");
      }
      upsertInvoice(storageScope, {
        ...item,
        status: "DEFAULTED",
        wasDefaulted: true,
        defaultedAtMs: Date.now(),
        ratingScore: 1,
        ratedBy: accountAddress,
        autoDefaultRating: true,
        defaultDigest: defaultDigest ?? item.defaultDigest,
      });
    } catch (error) {
      setMessage(`mark_defaulted failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  async function onRate(item: InvoiceRecord) {
    if (!accountAddress || !sameIotaAddress(item.holder, accountAddress)) return;
    if (!canRateInvoice(item) || ((item.ratingScore ?? 0) > 0 && !canOverrideDefaultRating(item))) return;
    if (packageId && item.packageId && item.packageId !== packageId) {
      setMessage("This invoice belongs to a legacy contract version and cannot be rated here.");
      return;
    }
    const score = ratingInputs[item.id];
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      setMessage("Select a rating from 1 to 5.");
      return;
    }
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      let rateDigest: string | undefined;
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildRateInvoiceTx(targetPackageId, item.id, score);
        const result = await signAndExecute({ transaction: tx });
        await waitForSuccessfulTransaction({
          iotaClient,
          digest: result.digest,
          actionLabel: "Invoice rating",
        });
        rateDigest = result.digest;
        setMessage(`Rating submitted (${result.digest}).`);
      } else {
        setMessage("Rating saved in local demo mode.");
      }
      upsertInvoice(storageScope, {
        ...item,
        ratingScore: score,
        ratedBy: accountAddress,
        autoDefaultRating: false,
        rateDigest: rateDigest ?? item.rateDigest,
      });
    } catch (error) {
      setMessage(`rate_invoice failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusyId("");
    }
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

  function openRatings(title: string, address: string) {
    setModal({
      key: sellerRatingsKey(address),
      displayAddress: address,
      title,
    });
  }

  function renderCard(item: InvoiceRecord, role: "ISSUER" | "BUYER") {
    const isIssuer = role === "ISSUER";
    const isLive = isLivePortfolioPosition(item);
    const uiStatus = getUiStatus(item);
    const counterparty = isIssuer ? item.holder : item.issuer;
    const legacy = Boolean(packageId) && Boolean(item.packageId) && item.packageId !== packageId;
    const counterpartyStats = counterparty ? sellerRatings.get(sellerRatingsKey(counterparty)) : null;
    const auditItems = auditEntries(item).filter(([, value]) => Boolean(value));
    const auditEntryCount = auditItems.length + (item.notarizationCreatedAtMs ? 1 : 0);
    const ratingEligible =
      canRateInvoice(item) &&
      ((item.ratingScore ?? 0) === 0 || canOverrideDefaultRating(item));
    const defaultActionEnabled =
      item.status === "FUNDED" && item.lifecycleMode === "DEFAULT_SIMULATION";
    const counterpartyLabel = counterparty ? shortenAddress(counterparty) : "Not assigned";
    const entryPriceLabel = item.discountPriceNanos
      ? `IOTA ${formatIota(item.discountPriceNanos)}`
      : "Not listed";
    const counterpartyRatingsTitle = isIssuer
      ? "Counterparty Ratings (Buyer)"
      : "Counterparty Ratings (Seller)";
    const counterpartyRatingsLabel = isIssuer ? "Buyer ratings" : "Seller ratings";
    const amountCaption = isIssuer
      ? item.status === "DEFAULTED"
        ? "Recovery target"
        : "Repayment target"
      : item.status === "DEFAULTED"
        ? "Recovery target"
        : "Position size";
    const controlSummary = isIssuer
      ? item.status === "OPEN"
        ? "Cancel the listing while the claim is still open and unfunded."
        : item.status === "FUNDED"
          ? "Repay the funded claim from the issuer side to close the position."
          : item.status === "DEFAULTED"
            ? "Settle the recovered amount and close the stressed position."
            : "Issuer-side actions are not available in the current state."
      : ratingEligible
        ? canOverrideDefaultRating(item)
          ? "Override the auto-rating with the final buyer score."
          : "Submit the buyer rating once settlement is complete."
        : defaultActionEnabled
          ? "Watch the due timer and mark the claim as defaulted when eligible."
          : "Buyer-side position is currently read-only.";
    const summaryStats = [
      ["Face Value", `IOTA ${formatIota(item.amountNanos)}`],
      ["Counterparty", counterpartyLabel],
      ["Due Date", formatDueDate(item.dueDateEpochSec)],
      ["Entry Price", entryPriceLabel],
    ] as const;
    const actionAmount = isIssuer ? item.amountNanos : repayAmount(item);
    const invoiceExplorerUrl = item.id.startsWith("local-")
      ? null
      : buildObjectExplorerUrl(item.id, network);
    const toneClass = !isLive
      ? "border-white/10 bg-[linear-gradient(180deg,rgba(20,24,38,0.9),rgba(12,16,28,0.82))]"
      : isIssuer
        ? "border-cyan-300/18 bg-[linear-gradient(180deg,rgba(8,17,31,0.94),rgba(6,11,22,0.82))]"
        : "border-emerald-300/18 bg-[linear-gradient(180deg,rgba(8,18,21,0.92),rgba(6,13,16,0.78))]";
    const articleClass = isLive
      ? "panel panel-interactive px-4 py-3.5 sm:px-5"
      : "panel relative overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(15,19,32,0.96),rgba(10,14,24,0.9))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-5";
    const invoiceLinkClass = isLive
      ? "mt-1 block truncate font-mono text-sm text-slate-200 transition hover:text-cyan-100"
      : "mt-1 block truncate font-mono text-sm text-slate-300 transition hover:text-violet-100";
    const fieldShellClass = isLive
      ? "field-shell rounded-[16px] px-3 py-2"
      : "rounded-[16px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,11,20,0.82),rgba(6,10,18,0.68))] px-3 py-2";
    const auditShellClass = isLive
      ? "rounded-[16px] border border-white/10 bg-slate-950/18"
      : "rounded-[16px] border border-white/8 bg-white/[0.03] backdrop-blur-[2px]";
    const auditItemClass = isLive
      ? "rounded-[14px] border border-white/10 bg-slate-950/35 px-3 py-2.5 transition hover:border-cyan-300/30 hover:bg-slate-950/55"
      : "rounded-[14px] border border-white/8 bg-slate-950/28 px-3 py-2.5 transition hover:border-violet-300/30 hover:bg-slate-950/45";
    const roleChipClass =
      role === "ISSUER"
        ? "chip border-cyan-300/35 bg-cyan-500/10 text-cyan-100"
        : "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100";
    const statusChipClass =
      uiStatus === "LISTED"
        ? "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
        : uiStatus === "DEFAULTED"
          ? "chip border-red-300/35 bg-red-500/15 text-red-100"
          : uiStatus === "RECOVERED"
            ? "chip border-violet-300/35 bg-violet-500/15 text-violet-100"
            : uiStatus === "REPAID"
              ? "chip border-slate-200/20 bg-white/8 text-slate-100"
              : uiStatus === "UNLISTED"
                ? "chip border-slate-300/25 bg-slate-700/25 text-slate-100"
                : "chip";
    const infoSummary = (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {counterparty ? (
          <button
            type="button"
            className={
              isLive
                ? "rounded-xl border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
                : "rounded-xl border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-violet-300/35 hover:text-violet-100"
            }
            onClick={(event) => {
              if ("preventDefault" in event) {
                event.preventDefault();
              }
              openRatings(counterpartyRatingsTitle, counterparty);
            }}
          >
            {counterpartyRatingsLabel}:{" "}
            {counterpartyStats
              ? `${counterpartyStats.avg.toFixed(1)}/5 (${counterpartyStats.count})`
              : "No ratings"}
          </button>
        ) : (
          <span className="chip border-white/10 bg-white/4 text-slate-300">
            Counterparty not assigned
          </span>
        )}
        {item.ratingScore ? (
          <span className="chip border-cyan-300/24 bg-cyan-500/10 text-cyan-100">
            Rating {item.ratingScore}/5
            {item.autoDefaultRating ? " auto" : ""}
          </span>
        ) : null}
        {(item.status === "RECOVERED" || item.wasDefaulted) ? (
          <span className="chip border-violet-300/24 bg-violet-500/12 text-violet-100">
            Defaulted lifecycle retained
          </span>
        ) : null}
        {item.status === "DEFAULTED" ? (
          <span className="chip border-red-300/24 bg-red-500/12 text-red-100">
            Recovery IOTA {formatIota(repayAmount(item))}
          </span>
        ) : null}
      </div>
    );

    return (
      <article key={`${role}-${item.id}`} className={articleClass}>
        {!isLive ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-violet-300/55 to-transparent" />
        ) : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Invoice</p>
                {invoiceExplorerUrl ? (
                  <a
                    href={invoiceExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={invoiceLinkClass}
                    title="Open invoice object in explorer"
                  >
                    {shortenId(item.id)}
                  </a>
                ) : (
                  <p className="mt-1 truncate font-mono text-sm text-slate-200">
                    {shortenId(item.id)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className={roleChipClass}>{role}</p>
                {!isLive ? (
                  <p className="chip border-violet-300/28 bg-violet-500/12 text-violet-100">
                    Closed
                  </p>
                ) : null}
                <p className={statusChipClass}>{uiStatus}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {summaryStats.map(([label, value]) => (
                <div key={label} className={fieldShellClass}>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
                  <p className="mt-1.5 text-sm font-semibold tracking-[-0.02em] text-white">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {auditEntryCount > 0 ? (
              <details className={auditShellClass}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  {infoSummary}
                  <span
                    className={
                      isLive
                        ? "chip shrink-0 border-white/12 bg-white/5 text-slate-100"
                        : "chip shrink-0 border-violet-300/18 bg-violet-500/10 text-violet-100"
                    }
                  >
                    Audit {auditEntryCount}
                  </span>
                </summary>
                <div className="grid gap-2 border-t border-white/8 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-4">
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
                      className={auditItemClass}
                    >
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-200">
                        {shortenId(value)}
                      </p>
                    </a>
                  ))}
                  {item.notarizationCreatedAtMs ? (
                    <div className={auditItemClass}>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Notarized At
                      </p>
                      <p className="mt-1 text-xs text-slate-200">
                        {new Date(item.notarizationCreatedAtMs).toLocaleString()}
                      </p>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : (
              <div className={`${auditShellClass} px-3 py-2`}>
                {infoSummary}
              </div>
            )}
          </div>

          <aside className={`rounded-[18px] border px-4 py-3 ${toneClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{isIssuer ? "Issuer Desk" : "Buyer Desk"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">{controlSummary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-semibold tracking-[-0.04em] text-white">
                  IOTA {formatIota(actionAmount)}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  {amountCaption}
                </p>
              </div>
            </div>

            <div className="mt-3 border-t border-white/8 pt-3">
              {isIssuer ? (
                item.status === "OPEN" ? (
                  <button
                    className="btn-ghost h-11 w-full border-red-300/40 bg-red-500/20 px-4 text-sm text-red-100 hover:bg-red-500/30"
                    onClick={() => void onCancel(item)}
                    disabled={busyId === item.id}
                  >
                    cancel_invoice
                  </button>
                ) : item.status === "FUNDED" || item.status === "DEFAULTED" ? (
                  <button
                    className="btn h-11 w-full px-4 text-sm"
                    onClick={() => void onRepay(item)}
                    disabled={busyId === item.id}
                  >
                    {item.status === "DEFAULTED" ? "settle_defaulted" : "repay_invoice"}
                  </button>
                ) : (
                  <p className="text-xs leading-5 text-slate-300">
                    Issuer position is read-only in the current state.
                  </p>
                )
              ) : ratingEligible ? (
                legacy ? (
                  <p className="text-xs leading-5 text-amber-200">
                    Rating unavailable: this invoice was created with an older contract version.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={`${item.id}-${score}`}
                          className={
                            ratingInputs[item.id] === score
                              ? "rounded-xl border border-cyan-300/40 bg-cyan-500/20 px-3 py-1.5 text-sm font-semibold text-cyan-100"
                              : "rounded-xl border border-white/15 bg-slate-950/40 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100"
                          }
                          onClick={() =>
                            setRatingInputs((prev) => ({ ...prev, [item.id]: score }))
                          }
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-center">
                      <p className="text-xs leading-5 text-slate-300">
                        {canOverrideDefaultRating(item)
                          ? "Override the default auto-rating with the final buyer score."
                          : "Rate the issuer from 1 to 5 after settlement."}
                      </p>
                      <button
                        className="btn h-11 w-full px-4 text-sm"
                        onClick={() => void onRate(item)}
                        disabled={busyId === item.id || !ratingInputs[item.id]}
                      >
                        submit_rating
                      </button>
                    </div>
                  </div>
                )
              ) : defaultActionEnabled ? (
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
                  <p
                    className={
                      isDueForDefault(item, nowSec)
                        ? "text-xs leading-5 text-slate-300"
                        : "text-xs leading-5 text-amber-200"
                    }
                  >
                    {isDueForDefault(item, nowSec)
                      ? "Due threshold reached. Default can be marked now."
                      : `Default opens in ${Math.max(item.dueDateEpochSec - nowSec, 0)}s.`}
                  </p>
                  <button
                    className="btn h-11 w-full px-4 text-sm"
                    onClick={() => void onMarkDefaulted(item)}
                    disabled={busyId === item.id || !isDueForDefault(item, nowSec)}
                  >
                    mark_defaulted
                  </button>
                </div>
              ) : (
                <p className="text-xs leading-5 text-slate-300">
                  Buyer position is currently read-only.
                </p>
              )}
            </div>
          </aside>
        </div>
      </article>
    );
  }

  return (
    <section className="space-y-5">
      <div className="panel space-y-4 px-5 py-5 sm:px-6">
        <QuickAccessStrip
          summary="Go straight to the desk you need. The badge shows live positions in each book, while the supporting line tells you how many actions still need attention."
          items={[
            {
              href: "#issuer-book",
              kicker: "Issuer desk",
              title: "Manage originations",
              detail: `${pluralize(issuerActionCount, "action")} pending across listing cleanup, repayments and stressed issuer-side positions.`,
              badge: `${issuerLiveCount} live`,
              emphasis: issuerActionCount > 0,
            },
            {
              href: "#buyer-book",
              kicker: "Buyer desk",
              title: "Manage holdings",
              detail: `${pluralize(buyerActionCount, "action")} pending across default paths, ratings and settlement follow-up.`,
              badge: `${buyerLiveCount} live`,
              emphasis: buyerActionCount > 0,
            },
          ]}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div>
            <p className="eyebrow">Position Control Room</p>
            <h1 className="mt-2 text-[clamp(2rem,4vw,3.2rem)] font-semibold tracking-[-0.06em] text-white">
              Move straight to the desk that needs action.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Keep issuer and buyer work separate: issuer cards handle repayment and listing
              cleanup, while buyer cards focus on default handling and ratings.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="chip border-cyan-300/24 bg-cyan-500/10 text-cyan-100">
                Network: {network}
              </span>
              <span className="chip border-white/10 bg-white/4 text-slate-200">
                {account?.address ? shortenAddress(account.address) : "Wallet not connected"}
              </span>
              <span className="chip border-white/10 bg-white/4 text-slate-200">
                {packageId ? "Deploy-linked portfolio" : "Local demo portfolio"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {portfolioMetrics.map(([label, value, caption]) => (
              <div key={label} className="metric-card px-4 py-4">
                <p className="metric-label">{label}</p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  {value}
                </p>
                <p className="metric-caption mt-2">{caption}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden rounded-[24px] border border-white/10 bg-white/4 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="metric-label">Operator Guide</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Jump directly to the issuer or buyer desk. Live counts show how many positions sit
                in each book, while pending counts show where action is waiting now.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="#issuer-book" className="btn-secondary px-4 py-2.5">
                Issuer desk · {issuerActionCount}
              </a>
              <a href="#buyer-book" className="btn-secondary px-4 py-2.5">
                Buyer desk · {buyerActionCount}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-4 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Issuer Snapshot</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Your origination side: fundraising status, due pressure and completed exits.
              </p>
            </div>
            <button
              type="button"
              className="rounded-[20px] border border-cyan-300/35 bg-cyan-500/10 px-3 py-3 text-left transition hover:border-cyan-200/50 hover:bg-cyan-500/15"
              onClick={() => account?.address && openRatings("My Seller Ratings", account.address)}
            >
              <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/90">
                Seller Ratings
              </p>
              <p className="mt-1 text-sm font-semibold text-cyan-100">
                {selfRatingStats.count > 0
                  ? `${selfRatingStats.avg.toFixed(1)}/5 (${selfRatingStats.count})`
                  : "No ratings yet"}
              </p>
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {issuerKpis.map(([label, value]) => (
              <div
                key={label}
                className="rounded-[22px] border border-cyan-300/20 bg-cyan-500/8 px-4 py-4"
              >
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="panel space-y-4 px-5 py-5">
          <div>
            <p className="eyebrow">Buyer Snapshot</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Your holder side: active exposure, recoveries and the average quality of sellers
              you backed.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {buyerKpis.map(([label, value], index) => (
              <div
                key={label}
                className={`rounded-[22px] border px-4 py-4 ${
                  index === 0
                    ? "border-emerald-300/20 bg-emerald-500/8"
                    : "border-white/10 bg-slate-950/30"
                }`}
              >
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? <div className="panel p-5 text-slate-300">Loading portfolio positions...</div> : null}
      {!isLoading && error ? <div className="panel p-5 text-red-200">Unable to load portfolio data. {error instanceof Error ? error.message : ""}</div> : null}
      {!isLoading && !error && visibleRecords.length === 0 ? (
        <div className="panel p-5 text-slate-300">{account?.address ? "No portfolio positions for this wallet on current network." : "Connect a wallet to view portfolio positions."}</div>
      ) : null}

      <div id="issuer-book" className="scroll-mt-40 space-y-4" aria-busy={isFetching}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Issuer Book</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
              As Issuer
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-cyan-300/24 bg-cyan-500/10 text-cyan-100">
              {issuerRecords.length} positions
            </span>
            {issuerClosedCount > 0 ? (
              <span className="chip border-violet-300/22 bg-violet-500/10 text-violet-100">
                {issuerClosedCount} closed
              </span>
            ) : null}
          </div>
        </div>
        {issuerRecords.length === 0 ? (
          <div className="panel p-4 text-sm text-slate-400">No issuer positions.</div>
        ) : (
          <div className="grid gap-4">{sortedIssuerRecords.map((item) => renderCard(item, "ISSUER"))}</div>
        )}
      </div>

      <div id="buyer-book" className="scroll-mt-40 space-y-4" aria-busy={isFetching}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Buyer Book</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
              As Buyer
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-emerald-300/24 bg-emerald-500/10 text-emerald-100">
              {buyerRecords.length} positions
            </span>
            {buyerClosedCount > 0 ? (
              <span className="chip border-violet-300/22 bg-violet-500/10 text-violet-100">
                {buyerClosedCount} closed
              </span>
            ) : null}
          </div>
        </div>
        {buyerRecords.length === 0 ? (
          <div className="panel p-4 text-sm text-slate-400">No buyer positions.</div>
        ) : (
          <div className="grid gap-4">{sortedBuyerRecords.map((item) => renderCard(item, "BUYER"))}</div>
        )}
      </div>

      {modal ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={() => setModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="portfolio-ratings-title"
            className="w-full max-w-2xl rounded-[28px] border border-white/15 bg-[linear-gradient(180deg,rgba(9,12,24,0.99),rgba(6,10,20,0.97))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p id="portfolio-ratings-title" className="eyebrow">{modal.title}</p>
                <p className="mt-2 font-mono text-sm text-slate-200">{modal.displayAddress}</p>
              </div>
              <button
                ref={closeModalRef}
                className="btn-ghost px-3 py-2 text-xs"
                onClick={() => setModal(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {(sellerRatings.get(modal.key)?.entries ?? []).length === 0 ? (
                <p className="rounded-[20px] border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">No ratings available for this profile.</p>
              ) : (
                sellerRatings.get(modal.key)?.entries.map((entry) => (
                  <div key={`${entry.invoiceId}-${entry.score}`} className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs text-slate-300">{shortenId(entry.invoiceId)}</p>
                      <div className="flex items-center gap-2">
                        {entry.status === "DEFAULTED" || entry.status === "RECOVERED" || entry.wasDefaulted ? (
                          <p className={entry.status === "DEFAULTED" ? "chip border-red-300/35 bg-red-500/15 text-red-100" : "chip border-violet-300/35 bg-violet-500/15 text-violet-100"}>
                            {entry.status === "DEFAULTED" ? "DEFAULTED" : "DEFAULTED/RECOVERED"}
                          </p>
                        ) : null}
                        <p className="text-sm font-semibold text-cyan-100">{entry.score}/5</p>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Face Value: IOTA {formatIota(entry.amountNanos)} | Due {formatDueDate(entry.dueDateEpochSec)}
                      {entry.ratedBy ? ` | Rated by ${shortenAddress(entry.ratedBy)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="text-sm text-cyan-200">{message}</p>
    </section>
  );
}
