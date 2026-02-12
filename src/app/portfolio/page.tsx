"use client";

import {
  useCurrentAccount,
  useIotaClient,
  useSignAndExecuteTransaction,
} from "@iota/dapp-kit";
import { normalizeIotaAddress } from "@iota/iota-sdk/utils";
import { useEffect, useMemo, useState } from "react";
import { useEffectivePackageId } from "@/components/app-providers";
import {
  buildCancelTx,
  buildMarkDefaultedTx,
  buildRateInvoiceTx,
  buildRepayTx,
} from "@/lib/iota-tx";
import { formatIota } from "@/lib/iota-amount";
import {
  computeDefaultRepayAmount,
  InvoiceRecord,
  hideInvoiceIds,
  isTerminalStatus,
  isPortfolioHideAllPending,
  loadHiddenInvoiceIds,
  loadInvoices,
  saveInvoices,
  setPortfolioHideAllPending,
} from "@/lib/invoice-store";
import { fetchOnchainInvoices } from "@/lib/onchain-invoices";

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId } = useEffectivePackageId();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [ratingInputs, setRatingInputs] = useState<Record<string, number>>({});
  const [sellerRatingsModal, setSellerRatingsModal] = useState<{
    key: string;
    displayAddress: string;
    title: string;
  } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  function mergeTerminalLocalState(chainItem: InvoiceRecord, localItem: InvoiceRecord) {
    const chainIsTerminal = isTerminalStatus(chainItem.status);
    const localIsTerminal = isTerminalStatus(localItem.status);

    // Keep local terminal state only while chain/indexer is still non-terminal.
    const merged: InvoiceRecord =
      !chainIsTerminal && localIsTerminal
        ? { ...chainItem, ...localItem }
        : { ...localItem, ...chainItem };

    if ((merged.ratingScore ?? 0) <= 0 && (chainItem.ratingScore ?? 0) > 0) {
      merged.ratingScore = chainItem.ratingScore;
    }
    if (!merged.ratedBy && chainItem.ratedBy) {
      merged.ratedBy = chainItem.ratedBy;
    }

    // Preserve local digests if chain payload does not carry them.
    merged.createDigest = chainItem.createDigest ?? localItem.createDigest;
    merged.fundDigest = chainItem.fundDigest ?? localItem.fundDigest;
    merged.repayDigest = chainItem.repayDigest ?? localItem.repayDigest;

    return merged;
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const hideAllPending = isPortfolioHideAllPending();
      const hidden = new Set(loadHiddenInvoiceIds());
      setHiddenIds(hidden);

      const local = loadInvoices();
      const onchain = packageId
        ? await fetchOnchainInvoices(iotaClient, packageId).catch(() => [])
        : [];

      if (cancelled) return;

      const byId = new Map<string, InvoiceRecord>();
      onchain.forEach((item) => byId.set(item.id, item));
      local.forEach((item) => {
        const chainItem = byId.get(item.id);
        if (!chainItem) {
          byId.set(item.id, item);
          return;
        }

        // Keep terminal local state while indexer catches up.
        if (isTerminalStatus(item.status)) {
          byId.set(item.id, mergeTerminalLocalState(chainItem, item));
        }
      });
      const merged = [...byId.values()];
      if (hideAllPending) {
        const idsToHide = merged.map((item) => item.id);
        hideInvoiceIds(idsToHide);
        const nextHidden = new Set([...hidden, ...idsToHide]);
        setHiddenIds(nextHidden);
        setPortfolioHideAllPending(false);
        setRecords([]);
        return;
      }
      setRecords(merged.filter((item) => !hidden.has(item.id)));
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [iotaClient, packageId]);

  const visibleRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          (item.issuer === account?.address || item.holder === account?.address) &&
          item.status !== "CANCELLED" &&
          !hiddenIds.has(item.id),
      ),
    [records, account?.address, hiddenIds],
  );

  const issuerRecords = useMemo(
    () => visibleRecords.filter((item) => item.issuer === account?.address),
    [visibleRecords, account?.address],
  );

  const buyerRecords = useMemo(
    () => visibleRecords.filter((item) => item.holder === account?.address),
    [visibleRecords, account?.address],
  );

  const sellerRatings = useMemo(() => {
    const bySeller = new Map<
      string,
      {
        avg: number;
        count: number;
        entries: Array<{
          invoiceId: string;
          score: number;
          amount: number;
          dueDateEpochSec: number;
          ratedBy: string | null;
          status: InvoiceRecord["status"];
          wasDefaulted: boolean;
        }>;
      }
    >();

    for (const item of records) {
      const score = item.ratingScore ?? 0;
      if (!Number.isFinite(score) || score < 1 || score > 5) continue;

      const sellerKey = normalizeAddress(item.issuer);
      const current = bySeller.get(sellerKey) ?? {
        avg: 0,
        count: 0,
        entries: [],
      };

      current.count += 1;
      current.avg = ((current.avg * (current.count - 1)) + score) / current.count;
      current.entries.push({
        invoiceId: item.id,
        score,
        amount: item.amount,
        dueDateEpochSec: item.dueDateEpochSec,
        ratedBy: item.ratedBy ?? null,
        status: item.status,
        wasDefaulted: item.wasDefaulted ?? false,
      });

      bySeller.set(sellerKey, current);
    }

    for (const [, value] of bySeller) {
      value.entries.sort((a, b) => b.dueDateEpochSec - a.dueDateEpochSec);
    }

    return bySeller;
  }, [records]);

  const sellerRatingStats = useMemo(() => {
    const sellerAddress = account?.address;
    if (!sellerAddress) {
      return {
        avg: 0,
        count: 0,
        entries: [] as Array<{
          invoiceId: string;
          score: number;
          amount: number;
          dueDateEpochSec: number;
          ratedBy: string | null;
          status: InvoiceRecord["status"];
          wasDefaulted: boolean;
        }>,
      };
    }
    return (
      sellerRatings.get(normalizeAddress(sellerAddress)) ?? {
        avg: 0,
        count: 0,
        entries: [] as Array<{
          invoiceId: string;
          score: number;
          amount: number;
          dueDateEpochSec: number;
          ratedBy: string | null;
          status: InvoiceRecord["status"];
          wasDefaulted: boolean;
        }>,
      }
    );
  }, [sellerRatings, account?.address]);

  function normalizeAddress(value: string) {
    try {
      return normalizeIotaAddress(value);
    } catch {
      return value.toLowerCase();
    }
  }

  function shortenId(value: string) {
    if (value.length <= 16) return value;
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  }

  function shortenAddress(value: string) {
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function getUiStatus(item: InvoiceRecord): "UNLISTED" | "LISTED" | InvoiceRecord["status"] {
    if (item.status === "OPEN") {
      return item.discountPrice ? "LISTED" : "UNLISTED";
    }
    return item.status;
  }

  function isDueForDefault(item: InvoiceRecord) {
    return item.dueDateEpochSec > 0 && nowSec > item.dueDateEpochSec;
  }

  function canRateInvoice(item: InvoiceRecord) {
    return item.status === "REPAID" || item.status === "RECOVERED";
  }

  function canOverrideDefaultRating(item: InvoiceRecord) {
    return (
      item.status === "RECOVERED" &&
      (item.ratingScore ?? 0) > 0 &&
      item.autoDefaultRating === true
    );
  }

  function getRepayAmountForStatus(item: InvoiceRecord) {
    if (item.status === "DEFAULTED") {
      return computeDefaultRepayAmount(item.amount);
    }
    return item.amount;
  }

  async function onRepay(item: InvoiceRecord) {
    if (!account?.address || item.issuer !== account.address) return;
    if (item.status !== "FUNDED" && item.status !== "DEFAULTED") return;
    const targetPackageId = item.packageId || packageId;
    const repayAmount = getRepayAmountForStatus(item);
    setBusyId(item.id);
    try {
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildRepayTx(targetPackageId, item.id, repayAmount);
        const result = await signAndExecute({ transaction: tx });
        setMessage(
          item.status === "DEFAULTED"
            ? `Default recovered (${result.digest}).`
            : `Repayment sent (${result.digest}).`,
        );
      } else {
        setMessage(
          item.status === "DEFAULTED"
            ? "Default recovered in local demo mode."
            : "Repayment marked in local demo mode.",
        );
      }
      const recoveredAtMs = item.status === "DEFAULTED" ? Date.now() : null;
      const next = records.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: item.status === "DEFAULTED" ? ("RECOVERED" as const) : ("REPAID" as const),
              wasDefaulted: item.status === "DEFAULTED" ? true : row.wasDefaulted,
              recoveredAtMs: recoveredAtMs ?? row.recoveredAtMs ?? null,
            }
          : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`repay_invoice failed: ${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function onCancel(item: InvoiceRecord) {
    if (!account?.address || item.issuer !== account.address) return;
    if (item.status !== "OPEN") return;
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildCancelTx(targetPackageId, item.id);
        const result = await signAndExecute({ transaction: tx });
        setMessage(`Invoice cancelled (${result.digest}).`);
      } else {
        setMessage("Invoice cancelled in local demo mode.");
      }

      const next = records.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: "CANCELLED" as const,
              discountPrice: null,
            }
          : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`cancel_invoice failed: ${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function onMarkDefaulted(item: InvoiceRecord) {
    if (!account?.address || item.holder !== account.address) return;
    if (item.status !== "FUNDED") return;
    if (item.lifecycleMode !== "DEFAULT_SIMULATION") return;
    if (!isDueForDefault(item)) {
      setMessage("Invoice is not due for default yet.");
      return;
    }

    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildMarkDefaultedTx(targetPackageId, item.id);
        const result = await signAndExecute({ transaction: tx });
        setMessage(`Invoice defaulted (${result.digest}).`);
      } else {
        setMessage("Invoice defaulted in local demo mode.");
      }

      const nowMs = Date.now();
      const next = records.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: "DEFAULTED" as const,
              wasDefaulted: true,
              defaultedAtMs: nowMs,
              ratingScore: 1,
              ratedBy: account.address,
              autoDefaultRating: true,
            }
          : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`mark_defaulted failed: ${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function onRate(item: InvoiceRecord) {
    if (!account?.address || item.holder !== account.address) return;
    if (!canRateInvoice(item)) return;
    if ((item.ratingScore ?? 0) > 0 && !canOverrideDefaultRating(item)) return;
    if (packageId && item.packageId && item.packageId !== packageId) {
      setMessage(
        "This invoice belongs to a legacy contract version and cannot be rated here.",
      );
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
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildRateInvoiceTx(targetPackageId, item.id, score);
        const result = await signAndExecute({ transaction: tx });
        setMessage(`Rating submitted (${result.digest}).`);
      } else {
        setMessage("Rating saved in local demo mode.");
      }

      const next = records.map((row) =>
        row.id === item.id
          ? {
              ...row,
              ratingScore: score,
              ratedBy: account.address,
              autoDefaultRating: false,
            }
          : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`rate_invoice failed: ${message}`);
    } finally {
      setBusyId("");
    }
  }

  function renderCard(item: InvoiceRecord, role: "ISSUER" | "BUYER") {
    const isIssuer = role === "ISSUER";
    const uiStatus = getUiStatus(item);
    const isLegacyInvoice =
      Boolean(packageId) && Boolean(item.packageId) && item.packageId !== packageId;
    const counterpartyAddress = isIssuer ? item.holder : item.issuer;
    const counterpartyStats = counterpartyAddress
      ? sellerRatings.get(normalizeAddress(counterpartyAddress))
      : null;
    return (
      <article key={`${role}-${item.id}`} className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="break-all text-sm">{item.id}</p>
          <div className="flex items-center gap-2">
            <p
              className={
                role === "ISSUER"
                  ? "chip border-cyan-300/35 bg-cyan-500/10 text-cyan-100"
                  : "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
              }
            >
              {role}
            </p>
            <p
              className={
                uiStatus === "LISTED"
                  ? "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                  : uiStatus === "DEFAULTED"
                    ? "chip border-red-300/35 bg-red-500/15 text-red-100"
                    : uiStatus === "RECOVERED"
                      ? "chip border-violet-300/35 bg-violet-500/15 text-violet-100"
                  : uiStatus === "UNLISTED"
                    ? "chip border-slate-300/25 bg-slate-700/25 text-slate-100"
                    : "chip"
              }
            >
              {uiStatus}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
          <p>Issuer: {item.issuer.slice(0, 8)}...</p>
          <p>
            Holder: {item.holder ? `${item.holder.slice(0, 8)}...` : "None"}
          </p>
          <p>
            Face Value: IOTA {formatIota(item.amount)}
            {item.discountPrice ? ` | Paid IOTA ${formatIota(item.discountPrice)}` : ""}
          </p>
        </div>
        <div className="mt-3">
          {counterpartyAddress ? (
            <button
              type="button"
              className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
              onClick={() =>
                setSellerRatingsModal({
                  key: normalizeAddress(counterpartyAddress),
                  displayAddress: counterpartyAddress,
                  title: isIssuer ? "Counterparty Ratings (Buyer)" : "Counterparty Ratings (Seller)",
                })
              }
            >
              Counterparty ratings:{" "}
              {counterpartyStats
                ? `${counterpartyStats.avg.toFixed(1)}/5 (${counterpartyStats.count})`
                : "No ratings"}
            </button>
          ) : (
            <p className="text-xs text-slate-400">Counterparty not assigned yet.</p>
          )}
        </div>
        {item.status === "DEFAULTED" ? (
          <p className="mt-2 text-sm text-red-200">
            Default fee applied. Recovery amount: IOTA {formatIota(getRepayAmountForStatus(item))}
          </p>
        ) : null}
        {item.status === "RECOVERED" || item.wasDefaulted ? (
          <p className="mt-2 text-xs text-violet-200">
            Feedback tag: DEFAULTED / RECOVERED lifecycle retained.
          </p>
        ) : null}
        {item.ratingScore ? (
          <p className="mt-3 text-sm text-cyan-100">
            Rating: {item.ratingScore}/5
            {item.autoDefaultRating ? " (auto-default)" : ""}
          </p>
        ) : null}
        <div className="mt-4">
          {isIssuer ? (
            <>
              {item.status === "FUNDED" || item.status === "DEFAULTED" ? (
                <button
                  className="btn"
                  onClick={() => onRepay(item)}
                  disabled={busyId === item.id}
                >
                  {item.status === "DEFAULTED" ? "settle_defaulted" : "repay_invoice"}
                </button>
              ) : null}
              {item.status === "OPEN" ? (
                <button
                  className="ml-2 rounded-xl border border-red-300/40 bg-red-500/20 px-4 py-2 text-sm text-red-100 hover:bg-red-500/30"
                  onClick={() => void onCancel(item)}
                  disabled={busyId === item.id}
                >
                  cancel_invoice
                </button>
              ) : null}
            </>
          ) : (
            <>
              {canRateInvoice(item) &&
              ((item.ratingScore ?? 0) === 0 || canOverrideDefaultRating(item)) ? (
                isLegacyInvoice ? (
                  <p className="text-xs text-amber-200">
                    Rating unavailable: this invoice was created with an older contract
                    version.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300">
                      {canOverrideDefaultRating(item)
                        ? "Override default auto-rating (1-5):"
                        : "Rate issuer (1-5):"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={`${item.id}-rate-${score}`}
                          className={
                            ratingInputs[item.id] === score
                              ? "rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-1.5 text-sm font-semibold text-cyan-100"
                              : "rounded-lg border border-white/15 bg-slate-950/40 px-3 py-1.5 text-sm text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                          }
                          onClick={() =>
                            setRatingInputs((prev) => ({ ...prev, [item.id]: score }))
                          }
                        >
                          {score}
                        </button>
                      ))}
                      <button
                        className="btn ml-1"
                        onClick={() => void onRate(item)}
                        disabled={busyId === item.id || !ratingInputs[item.id]}
                      >
                        submit_rating
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {item.status === "FUNDED" && item.lifecycleMode === "DEFAULT_SIMULATION" ? (
                    <>
                      <button
                        className="btn"
                        onClick={() => void onMarkDefaulted(item)}
                        disabled={busyId === item.id || !isDueForDefault(item)}
                      >
                        mark_defaulted
                      </button>
                      {!isDueForDefault(item) ? (
                        <p className="text-xs text-amber-200">
                          Default not available yet. {Math.max(item.dueDateEpochSec - nowSec, 0)}s
                          remaining.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Buyer position (read-only).</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl">Portfolio</h1>
      {visibleRecords.length === 0 ? (
        <div className="panel p-5 text-slate-300">
          {account?.address
            ? "No portfolio positions for this wallet on current network."
            : "Connect a wallet to view portfolio positions."}
        </div>
      ) : null}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-200">
            As Issuer
          </h2>
          <button
            type="button"
            className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-left transition hover:border-cyan-200/50 hover:bg-cyan-500/15"
            onClick={() => {
              if (!account?.address) return;
              setSellerRatingsModal({
                key: normalizeAddress(account.address),
                displayAddress: account.address,
                title: "My Seller Ratings",
              });
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/90">
              Seller Ratings
            </p>
            <p className="mt-1 text-sm font-semibold text-cyan-100">
              {sellerRatingStats.count > 0
                ? `${sellerRatingStats.avg.toFixed(1)}/5 (${sellerRatingStats.count})`
                : "No ratings yet"}
            </p>
          </button>
        </div>
        {issuerRecords.length === 0 ? (
          <div className="panel p-4 text-sm text-slate-400">No issuer positions.</div>
        ) : (
          <div className="grid gap-4">{issuerRecords.map((item) => renderCard(item, "ISSUER"))}</div>
        )}
      </div>
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">
          As Buyer
        </h2>
        {buyerRecords.length === 0 ? (
          <div className="panel p-4 text-sm text-slate-400">No buyer positions.</div>
        ) : (
          <div className="grid gap-4">{buyerRecords.map((item) => renderCard(item, "BUYER"))}</div>
        )}
      </div>
      {sellerRatingsModal ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={() => setSellerRatingsModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[rgba(9,12,24,0.98)] p-5 shadow-[0_18px_36px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                  {sellerRatingsModal.title}
                </p>
                <p className="mt-1 font-mono text-sm text-slate-200">
                  {sellerRatingsModal.displayAddress}
                </p>
              </div>
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                onClick={() => setSellerRatingsModal(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {(sellerRatings.get(sellerRatingsModal.key)?.entries ?? []).length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                  No ratings available for this profile.
                </p>
              ) : (
                sellerRatings.get(sellerRatingsModal.key)?.entries.map((entry) => (
                  <div
                    key={`${entry.invoiceId}-${entry.score}`}
                    className="rounded-lg border border-white/10 bg-slate-950/40 p-3"
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
                      Face Value: IOTA {formatIota(entry.amount)} | Due{" "}
                      {new Date(entry.dueDateEpochSec * 1000).toLocaleDateString()}
                      {entry.ratedBy ? ` | Rated by ${shortenAddress(entry.ratedBy)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      <p className="text-sm text-cyan-200">{message}</p>
    </section>
  );
}
