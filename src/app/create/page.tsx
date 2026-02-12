"use client";

import { useIotaClient, useSignAndExecuteTransaction } from "@iota/dapp-kit";
import { useEffect, useRef, useState } from "react";
import { useCurrentAccount } from "@iota/dapp-kit";
import { useEffectivePackageId } from "@/components/app-providers";
import { buildCreateInvoiceSimulationTx, buildCreateInvoiceTx } from "@/lib/iota-tx";
import {
  DEFAULT_SIMULATION_DUE_OFFSET_SEC,
  InvoiceRecord,
  LIFECYCLE_MODE_EVENT,
  LifecycleMode,
  loadLifecycleMode,
  upsertInvoice,
} from "@/lib/invoice-store";
import { iotaToNanos, parseIotaInput } from "@/lib/iota-amount";

async function fileToSha256Hex(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function CreateInvoicePage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId, network } = useEffectivePackageId();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdfHashHex, setPdfHashHex] = useState("");
  const [status, setStatus] = useState("");
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>("NORMAL");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement | null>(null);
  const isDefaultSimulation = lifecycleMode === "DEFAULT_SIMULATION";
  const amountIota = parseIotaInput(amount);
  const isAmountValid = amountIota !== null && amountIota > 0;
  const hasDueDate = isDefaultSimulation || Boolean(dueDate);
  const canShowSubmit = Boolean(file) && Boolean(pdfHashHex) && isAmountValid && hasDueDate;

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

  function onSelectFile(nextFile: File | null) {
    setFile(nextFile);
    setPdfHashHex("");
    setStatus("");
  }

  async function onHash() {
    if (!file) return;
    setBusy(true);
    try {
      const hash = await fileToSha256Hex(file);
      setPdfHashHex(hash);
      setStatus("PDF hashed client-side.");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!account?.address || !pdfHashHex) return;
    const amountIota = parseIotaInput(amount);
    const dueDateEpochSec = isDefaultSimulation
      ? Math.floor(Date.now() / 1000) + DEFAULT_SIMULATION_DUE_OFFSET_SEC
      : Math.floor(new Date(dueDate).getTime() / 1000);
    if (amountIota === null || amountIota <= 0) {
      setStatus("Invalid amount. Enter an IOTA value greater than 0.");
      return;
    }
    const amountValue = iotaToNanos(amountIota);
    if (amountValue <= 0) {
      setStatus("Invalid amount. Enter an IOTA value greater than 0.");
      return;
    }
    if (!Number.isFinite(dueDateEpochSec) || dueDateEpochSec <= 0) {
      setStatus("Invalid due date.");
      return;
    }
    setStatus("Waiting for wallet confirmation...");
    setBusy(true);

    try {
      if (!packageId) {
        const fallbackId = `local-${Date.now()}`;
        const record: InvoiceRecord = {
          id: fallbackId,
          packageId,
          invoiceHashHex: pdfHashHex,
          amount: amountValue,
          dueDateEpochSec,
          issuer: account.address,
          holder: null,
          discountPrice: null,
          ratingScore: null,
          ratedBy: null,
          status: "OPEN",
          lifecycleMode,
          wasDefaulted: false,
          fundedAtMs: null,
          defaultedAtMs: null,
          recoveredAtMs: null,
        };
        upsertInvoice(record);
        setStatus(
          `Package ID missing on ${network}. Saved invoice locally for demo flow.`,
        );
        return;
      }

      const tx = isDefaultSimulation
        ? buildCreateInvoiceSimulationTx(
            packageId,
            pdfHashHex,
            amountValue,
            dueDateEpochSec,
          )
        : buildCreateInvoiceTx(
            packageId,
            pdfHashHex,
            amountValue,
            dueDateEpochSec,
          );

      const result = await signAndExecute({ transaction: tx });
      setStatus(`Wallet confirmed. Transaction submitted: ${result.digest}.`);

      let createdId: string | undefined;
      try {
        const settled = await iotaClient.waitForTransaction({
          digest: result.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
        const createdObjectChange = settled.objectChanges?.find(
          (item) =>
            item.type === "created" &&
            "objectType" in item &&
            typeof item.objectType === "string" &&
            item.objectType.includes("::invoice_vault::Invoice"),
        );
        const createdIdFromObjectChanges =
          createdObjectChange &&
          "objectId" in createdObjectChange &&
          typeof createdObjectChange.objectId === "string"
            ? createdObjectChange.objectId
            : undefined;
        createdId =
          createdIdFromObjectChanges ??
          settled.effects?.created?.[0]?.reference?.objectId;
      } catch {
        // Keep UX positive if tx is submitted but indexer/finalization is slower than usual.
      }

      if (!createdId) {
        setStatus(
          `Transaction submitted on ${network}: ${result.digest}. Invoice ID is still indexing, refresh Portfolio shortly.`,
        );
        return;
      }

      const record: InvoiceRecord = {
        id: createdId,
        packageId,
        invoiceHashHex: pdfHashHex,
        amount: amountValue,
        dueDateEpochSec,
        issuer: account.address,
        holder: null,
        discountPrice: null,
        ratingScore: null,
        ratedBy: null,
        status: "OPEN",
        createDigest: result.digest,
        lifecycleMode,
        wasDefaulted: false,
        fundedAtMs: null,
        defaultedAtMs: null,
        recoveredAtMs: null,
      };
      upsertInvoice(record);
      setStatus(`Invoice created on-chain: ${createdId} (${result.digest})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`On-chain submission failed on ${network}: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl">Create Invoice</h1>
      <div className="panel max-w-3xl space-y-5 p-6">
        <label className="block space-y-2">
          <span className="text-sm text-slate-300">Invoice PDF</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <div
            className={`flex items-center gap-3 rounded-xl border bg-slate-950/50 p-2 ${
              file ? "border-white/15" : "border-red-400/70"
            }`}
          >
            <button
              type="button"
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-white/10"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </button>
            <p className="min-w-0 flex-1 truncate text-left text-sm text-slate-300">
              {file ? file.name : "No file selected"}
            </p>
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">Amount (IOTA)</span>
            <input
              type="number"
              min={0.000001}
              step={0.000001}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`w-full rounded-xl border bg-slate-950/50 p-2 ${
                isAmountValid ? "border-white/15" : "border-red-400/70"
              }`}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">Due Date</span>
            <input
              ref={dueDateInputRef}
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={dueDate}
              disabled={isDefaultSimulation}
              onPointerDown={() => {
                try {
                  dueDateInputRef.current?.showPicker?.();
                } catch {
                  // Ignore: browsers without showPicker() support use native fallback.
                }
              }}
              onChange={(event) => setDueDate(event.target.value)}
              className={`w-full rounded-xl border bg-slate-950/50 p-2 ${
                hasDueDate ? "border-white/15" : "border-red-400/70"
              }`}
            />
            {isDefaultSimulation ? (
              <p className="text-xs text-amber-200">
                Default Simulation active: due date is set automatically at funding (+30s).
              </p>
            ) : null}
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            className="btn"
            onClick={onHash}
            disabled={!file || busy || Boolean(pdfHashHex)}
          >
            Hash PDF
          </button>
          {canShowSubmit ? (
            <button
              className="btn"
              onClick={onCreate}
              disabled={busy || !account}
            >
              Submit create_invoice
            </button>
          ) : null}
        </div>

        <p className="break-all text-sm text-slate-200">
          {pdfHashHex ? `SHA-256: ${pdfHashHex}` : "Hash not computed yet."}
        </p>
        <p className="text-sm text-cyan-200">{status}</p>
      </div>
    </section>
  );
}
