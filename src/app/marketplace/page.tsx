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
  DEFAULT_SIMULATION_DUE_OFFSET_SEC,
  InvoiceRecord,
  canWalletFund,
  hideInvoiceIds,
  isPortfolioHideAllPending,
  isTerminalStatus,
  loadHiddenInvoiceIds,
  loadInvoices,
  saveInvoices,
  setPortfolioHideAllPending,
} from "@/lib/invoice-store";
import {
  formatIota,
  iotaToNanos,
  nanosToIota,
  parseIotaInput,
} from "@/lib/iota-amount";
import { buildCancelTx, buildFundTx, buildListForFundingTx } from "@/lib/iota-tx";
import { fetchOnchainInvoices } from "@/lib/onchain-invoices";

export default function MarketplacePage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId } = useEffectivePackageId();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({});
  const [discountErrors, setDiscountErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [sellerModal, setSellerModal] = useState<
    { key: string; displayAddress: string } | null
  >(null);

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
    let cancelled = false;

    async function loadData() {
      const hideAllPending = isPortfolioHideAllPending();
      const hidden = new Set(loadHiddenInvoiceIds());
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
        hideInvoiceIds(merged.map((item) => item.id));
        setPortfolioHideAllPending(false);
        setRecords([]);
        setDiscountInputs({});
        setDiscountErrors({});
        return;
      }

      const visible = merged.filter((item) => !hidden.has(item.id));
      setRecords(visible);

      const initialInputs: Record<string, string> = {};
      const initialErrors: Record<string, string> = {};
      visible.forEach((item) => {
        initialInputs[item.id] = item.discountPrice
          ? String(nanosToIota(item.discountPrice))
          : "";
        initialErrors[item.id] = "";
      });
      setDiscountInputs(initialInputs);
      setDiscountErrors(initialErrors);
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [iotaClient, packageId]);

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

  async function onListForFunding(item: InvoiceRecord, discount: number) {
    if (!account?.address) return;
    const targetPackageId = item.packageId || packageId;
    setBusyId(item.id);
    try {
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildListForFundingTx(targetPackageId, item.id, discount);
        const result = await signAndExecute({ transaction: tx });
        setMessage(`Listed invoice ${item.id} (${result.digest}).`);
      } else {
        setMessage(`Listed invoice ${item.id} (local demo mode).`);
      }
      const next = records.map((row) =>
        row.id === item.id ? { ...row, discountPrice: discount } : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`list_for_funding failed: ${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function onFund(item: InvoiceRecord) {
    if (!account?.address || !canWalletFund(account.address)) return;
    if (item.status !== "OPEN") return;
    if (!item.discountPrice) return;
    if (item.issuer === account.address) return;
    const targetPackageId = item.packageId || packageId;

    setBusyId(item.id);
    try {
      const fundedAtMs = Date.now();
      const isSimulation = item.lifecycleMode === "DEFAULT_SIMULATION";
      const simulationDueDate = Math.floor(fundedAtMs / 1000) + DEFAULT_SIMULATION_DUE_OFFSET_SEC;
      if (targetPackageId && !item.id.startsWith("local-")) {
        const tx = buildFundTx(targetPackageId, item.id, item.discountPrice);
        const result = await signAndExecute({ transaction: tx });
        setMessage(`Funded invoice ${item.id} (${result.digest}).`);
      } else {
        setMessage(`Funded invoice ${item.id} (local demo mode).`);
      }

      const next = records.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: "FUNDED" as const,
              holder: account.address,
              fundedAtMs,
              dueDateEpochSec: isSimulation ? simulationDueDate : row.dueDateEpochSec,
            }
          : row,
      );
      saveInvoices(next);
      setRecords(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessage(`fund_invoice failed: ${message}`);
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
        setMessage(`Cancelled invoice ${item.id} (${result.digest}).`);
      } else {
        setMessage(`Cancelled invoice ${item.id} (local demo mode).`);
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

  const canFund = canWalletFund(account?.address);

  function getMaturityYieldPct(item: InvoiceRecord): number | null {
    if (!item.discountPrice || item.discountPrice <= 0) return null;
    return ((item.amount - item.discountPrice) / item.discountPrice) * 100;
  }

  function formatYield(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "N/D";
    if (value > 0) return `+${value.toFixed(2)}%`;
    return `${value.toFixed(2)}%`;
  }

  function getUiStatus(item: InvoiceRecord): "UNLISTED" | "LISTED" | InvoiceRecord["status"] {
    if (item.status === "OPEN") {
      return item.discountPrice ? "LISTED" : "UNLISTED";
    }
    return item.status;
  }

  function shortenId(value: string) {
    if (value.length <= 16) return value;
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  }

  function shortenAddress(value: string) {
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }

  function normalizeAddress(value: string) {
    try {
      return normalizeIotaAddress(value);
    } catch {
      return value.toLowerCase();
    }
  }

  async function onCopyInvoiceId(id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(id);
      setMessage(`Invoice ID copied: ${id}`);
    } catch {
      setMessage("Unable to copy invoice ID.");
    }
  }

  function getYieldTone(value: number | null) {
    if (value === null || !Number.isFinite(value)) {
      return {
        shell:
          "border-slate-300/20 bg-gradient-to-br from-slate-700/30 to-slate-800/20",
        value: "text-slate-100",
        badge:
          "border-slate-300/20 bg-slate-500/10 text-slate-200",
        badgeText: "UNLISTED",
      };
    }
    if (value > 0) {
      return {
        shell:
          "border-emerald-300/35 bg-gradient-to-br from-emerald-500/25 via-cyan-500/15 to-slate-900/20 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
        value: "text-emerald-200",
        badge:
          "border-emerald-300/35 bg-emerald-500/15 text-emerald-100",
        badgeText: "YIELD+",
      };
    }
    if (value === 0) {
      return {
        shell:
          "border-cyan-300/25 bg-gradient-to-br from-cyan-500/15 to-slate-900/20",
        value: "text-cyan-100",
        badge:
          "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
        badgeText: "PAR",
      };
    }
    return {
      shell:
        "border-amber-300/30 bg-gradient-to-br from-amber-500/20 to-slate-900/20",
      value: "text-amber-100",
      badge:
        "border-amber-300/30 bg-amber-500/15 text-amber-100",
      badgeText: "NEGATIVE",
    };
  }

  function renderYieldMetric(item: InvoiceRecord, yieldPct: number | null) {
    const tone = getYieldTone(yieldPct);
    return (
      <div
        className={`w-full rounded-xl border px-3 py-2 text-right backdrop-blur-sm sm:min-w-[190px] ${tone.shell}`}
      >
        <div className="flex items-center justify-end gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200/90">
            Yield
          </p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
            {tone.badgeText}
          </span>
        </div>
        <p className={`mt-1 text-xl font-semibold leading-none ${tone.value}`}>
          {formatYield(yieldPct)}
        </p>
        <p className="mt-1 text-[11px] text-slate-300">
          Buy{" "}
          {item.discountPrice ? formatIota(item.discountPrice) : "N/A"} {"->"} Repay{" "}
          {formatIota(item.amount)}
        </p>
        <p className="text-[11px] text-slate-300">at maturity</p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl">Marketplace</h1>
      {!canFund ? (
        <p className="chip inline-flex text-amber-200">
          Wallet not eligible to buy (allowlist/denylist rule).
        </p>
      ) : null}
      <div className="grid gap-4">
        {openRecords.length === 0 ? (
          <div className="panel p-5 text-slate-300">No invoices available.</div>
        ) : null}
        {openRecords.map((item) => {
          const yieldPct = getMaturityYieldPct(item);
          const uiStatus = getUiStatus(item);
          const isListed = uiStatus === "LISTED";
          const ratingStats = sellerRatings.get(normalizeAddress(item.issuer));
          return (
            <article key={item.id} className="panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
                    Invoice
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="font-mono text-sm text-slate-200" title={item.id}>
                      {shortenId(item.id)}
                    </p>
                    <button
                      type="button"
                      className="rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-cyan-300/50 hover:text-cyan-100"
                      onClick={() => void onCopyInvoiceId(item.id)}
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-slate-400">Seller:</p>
                    <button
                      type="button"
                      className="rounded-md border border-white/15 px-2 py-0.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
                      onClick={() =>
                        setSellerModal({
                          key: normalizeAddress(item.issuer),
                          displayAddress: item.issuer,
                        })
                      }
                    >
                      {shortenAddress(item.issuer)}{" "}
                      {ratingStats
                        ? `• ${ratingStats.avg.toFixed(1)}★ (${ratingStats.count})`
                        : "• No ratings"}
                    </button>
                  </div>
                </div>
                <p
                  className={
                    uiStatus === "LISTED"
                      ? "chip border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                      : uiStatus === "UNLISTED"
                        ? "chip border-slate-300/25 bg-slate-700/25 text-slate-100"
                        : "chip"
                  }
                >
                  {uiStatus}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Face Value
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-100">
                    IOTA {formatIota(item.amount)}
                  </p>
                </div>
                <div className="rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-cyan-100/90">
                    Buy Price
                  </p>
                  <p className="mt-1 text-base font-semibold text-cyan-100">
                    {item.discountPrice
                      ? `IOTA ${formatIota(item.discountPrice)}`
                      : "Not listed"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Due Date
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-100">
                    {new Date(item.dueDateEpochSec * 1000).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {item.issuer === account?.address && item.status === "OPEN" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="w-full max-w-56">
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        value={discountInputs[item.id] ?? ""}
                        placeholder="Enter buy price in IOTA"
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
                          if (parsedIota === null) return;
                          const parsedNanos = iotaToNanos(parsedIota);
                        if (parsedNanos > item.amount) {
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
                      className={`h-11 w-full rounded-xl border bg-slate-950/50 px-3 text-sm placeholder:text-slate-500 ${
                        discountErrors[item.id] ? "border-red-400/70" : "border-white/15"
                        }`}
                      />
                      {discountErrors[item.id] ? (
                        <p className="mt-1 text-xs text-red-300">{discountErrors[item.id]}</p>
                      ) : null}
                    </div>
                    <button
                      className="btn h-11 px-5"
                      onClick={() => {
                        const parsedIota = parseIotaInput(discountInputs[item.id] ?? "");
                        const parsed = parsedIota === null ? 0 : iotaToNanos(parsedIota);
                        if (parsedIota !== null && parsed > item.amount) {
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
                        if (
                          parsedIota === null ||
                          parsedIota <= 0 ||
                          parsed <= 0
                        ) {
                          setDiscountErrors((prev) => ({
                            ...prev,
                            [item.id]: "Enter a valid Buy Price.",
                          }));
                          setMessage("Enter a valid Buy Price.");
                          return;
                        }
                        setDiscountErrors((prev) => ({
                          ...prev,
                          [item.id]: "",
                        }));
                        void onListForFunding(item, parsed);
                      }}
                      disabled={busyId === item.id}
                    >
                      list_for_funding
                    </button>
                    <button
                      className="h-11 rounded-xl border border-red-300/25 bg-red-500/10 px-4 text-sm text-red-100 transition hover:bg-red-500/20"
                      onClick={() => void onCancel(item)}
                      disabled={busyId === item.id}
                    >
                      cancel_invoice
                    </button>
                  </div>
                  <div className="sm:justify-self-end">{renderYieldMetric(item, yieldPct)}</div>
                </div>
              ) : null}
              {item.status === "OPEN" && item.issuer !== account?.address && isListed ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="btn h-11 px-5"
                      onClick={() => onFund(item)}
                      disabled={busyId === item.id || !canFund}
                    >
                      fund_invoice
                    </button>
                  </div>
                  <div className="sm:justify-self-end">{renderYieldMetric(item, yieldPct)}</div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {sellerModal ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={() => setSellerModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[rgba(9,12,24,0.98)] p-5 shadow-[0_18px_36px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                  Seller Ratings
                </p>
                <p className="mt-1 font-mono text-sm text-slate-200">
                  {sellerModal.displayAddress}
                </p>
              </div>
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                onClick={() => setSellerModal(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {(sellerRatings.get(sellerModal.key)?.entries ?? []).length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                  No ratings available for this seller.
                </p>
              ) : (
                sellerRatings.get(sellerModal.key)?.entries.map((entry) => (
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
                        <p className="text-sm font-semibold text-cyan-100">
                          {entry.score}/5
                        </p>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Face Value: IOTA {formatIota(entry.amount)} • Due{" "}
                      {new Date(entry.dueDateEpochSec * 1000).toLocaleDateString()}
                      {entry.ratedBy ? ` • Rated by ${shortenAddress(entry.ratedBy)}` : ""}
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
