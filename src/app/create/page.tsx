"use client";

import {
  useCurrentAccount,
  useIotaClient,
  useSignAndExecuteTransaction,
} from "@iota/dapp-kit";
import { useEffect, useRef, useState } from "react";
import {
  useActiveStorageScope,
  useEffectivePackages,
} from "@/components/app-providers";
import { QuickAccessStrip } from "@/components/quick-access-strip";
import { useScopedInvoices } from "@/hooks/use-scoped-invoices";
import {
  formatLocalDateInputValue,
  parseLocalDateInputToDueEpochSec,
} from "@/lib/date-input";
import { waitForSuccessfulTransaction } from "@/lib/iota-execution";
import { normalizeIotaAddressValue } from "@/lib/iota-ids";
import {
  DEFAULT_SIMULATION_DUE_OFFSET_SEC,
  type InvoiceRecord,
  LIFECYCLE_MODE_EVENT,
  type LifecycleMode,
  findInvoiceByHash,
  loadLifecycleMode,
  upsertInvoice,
} from "@/lib/invoice-store";
import { iotaToNanos, parseIotaInput } from "@/lib/iota-amount";

type WorkflowPhase =
  | "idle"
  | "hashing"
  | "duplicate-check"
  | "notarizing"
  | "creating"
  | "completed"
  | "failed";

type StepTone = "pending" | "active" | "complete" | "warning" | "blocked";

const INVOICE_NOTARIZATION_STATE_METADATA =
  "application/vnd.invoicevault.pdf-hash+sha256;v=1";
const INVOICE_NOTARIZATION_DESCRIPTION = "InvoiceVault PDF SHA-256 anchor";

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

function stepClasses(tone: StepTone) {
  if (tone === "complete") {
    return "border-emerald-300/25 bg-emerald-500/10 text-emerald-100";
  }

  if (tone === "active") {
    return "border-cyan-300/30 bg-cyan-500/10 text-cyan-100";
  }

  if (tone === "warning") {
    return "border-amber-300/30 bg-amber-500/10 text-amber-100";
  }

  if (tone === "blocked") {
    return "border-red-300/30 bg-red-500/10 text-red-100";
  }

  return "border-white/10 bg-slate-950/30 text-slate-300";
}

function stepLabel(tone: StepTone) {
  if (tone === "complete") return "Done";
  if (tone === "active") return "In progress";
  if (tone === "warning") return "Warning";
  if (tone === "blocked") return "Blocked";
  return "Waiting";
}

async function loadHashingRuntime() {
  return import("@/lib/file-utils");
}

async function loadCreateSubmissionRuntime() {
  const [
    notarizationRuntime,
    invoiceTxRuntime,
    onchainInvoicesRuntime,
    fileUtilsRuntime,
  ] = await Promise.all([
    import("@/lib/iota-notarization"),
    import("@/lib/iota-tx"),
    import("@/lib/onchain-invoices"),
    import("@/lib/file-utils"),
  ]);

  return {
    ...notarizationRuntime,
    ...invoiceTxRuntime,
    ...onchainInvoicesRuntime,
    ...fileUtilsRuntime,
  };
}

export default function CreateInvoicePage() {
  const account = useCurrentAccount();
  const iotaClient = useIotaClient();
  const { packageId, network, notarizationPackageId } = useEffectivePackages();
  const storageScope = useActiveStorageScope();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const {
    mergedRecords,
    dataUpdatedAt,
    isFetching: recordsFetching,
    refetch: refetchScopedInvoices,
  } = useScopedInvoices({
    enabled: true,
  });

  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdfHashHex, setPdfHashHex] = useState("");
  const [status, setStatus] = useState("");
  const [duplicateRecord, setDuplicateRecord] = useState<InvoiceRecord | null>(null);
  const [duplicateCheckBusy, setDuplicateCheckBusy] = useState(false);
  const [duplicateCheckError, setDuplicateCheckError] = useState("");
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>("NORMAL");
  const [busy, setBusy] = useState(false);
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase>("idle");
  const [notarizationComplete, setNotarizationComplete] = useState(false);
  const [invoiceComplete, setInvoiceComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement | null>(null);
  const accountAddress = normalizeIotaAddressValue(account?.address);
  const isDefaultSimulation = lifecycleMode === "DEFAULT_SIMULATION";
  const parsedAmount = parseIotaInput(amount);
  const amountNanos = parsedAmount ? iotaToNanos(parsedAmount) : 0n;
  const isAmountValid = amountNanos > 0n;
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

  useEffect(() => {
    setDuplicateRecord(null);
    setDuplicateCheckError("");
    setWorkflowPhase("idle");
    setNotarizationComplete(false);
    setInvoiceComplete(false);
  }, [network, notarizationPackageId, packageId]);

  function onSelectFile(nextFile: File | null) {
    setFile(nextFile);
    setPdfHashHex("");
    setStatus("");
    setDuplicateRecord(null);
    setDuplicateCheckError("");
    setWorkflowPhase("idle");
    setNotarizationComplete(false);
    setInvoiceComplete(false);
  }

  async function getKnownInvoices(forceRefresh = false) {
    if (!forceRefresh && Date.now() - dataUpdatedAt < 15_000) {
      return mergedRecords;
    }

    const result = await refetchScopedInvoices();
    return result.data?.mergedRecords ?? mergedRecords;
  }

  async function verifyDuplicateHash(hashHex: string, forceRefresh = false) {
    setWorkflowPhase("duplicate-check");
    setDuplicateCheckBusy(true);

    try {
      const records = await getKnownInvoices(forceRefresh);
      const duplicate = findInvoiceByHash(records, hashHex);
      setDuplicateRecord(duplicate);
      setDuplicateCheckError("");
      return { duplicate, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to verify duplicate invoices.";
      setDuplicateRecord(null);
      setDuplicateCheckError(message);
      return { duplicate: null, error: message };
    } finally {
      setDuplicateCheckBusy(false);
      setWorkflowPhase("idle");
    }
  }

  async function onHash() {
    if (!file) return;

    setBusy(true);
    setWorkflowPhase("hashing");
    let failed = false;

    try {
      const { fileToSha256Hex } = await loadHashingRuntime();
      const hash = await fileToSha256Hex(file);
      setPdfHashHex(hash);
      setStatus("PDF hashed client-side. Checking for duplicates on the active deploy...");
      const { duplicate, error } = await verifyDuplicateHash(hash, true);

      if (duplicate) {
        setStatus(
          `Duplicate invoice detected on ${network}: ${duplicate.id}. This document hash is already registered on the active deploy.`,
        );
      } else if (error) {
        setStatus("PDF hashed client-side. Duplicate pre-check could not be completed.");
      } else {
        setStatus("PDF hashed client-side. No duplicate invoice detected on the active deploy.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      failed = true;
      setWorkflowPhase("failed");
      setStatus(`Hashing failed: ${message}`);
    } finally {
      setBusy(false);
      if (!failed) {
        setWorkflowPhase("idle");
      }
    }
  }

  async function onCreate() {
    if (!accountAddress || !pdfHashHex || !file) return;
    const normalizedAmount = parseIotaInput(amount);
    const dueDateEpochSec = isDefaultSimulation
      ? Math.floor(Date.now() / 1000) + DEFAULT_SIMULATION_DUE_OFFSET_SEC
      : parseLocalDateInputToDueEpochSec(dueDate);

    if (!normalizedAmount) {
      setStatus("Invalid amount. Enter an IOTA value greater than 0.");
      return;
    }

    const parsedAmountNanos = iotaToNanos(normalizedAmount);
    if (parsedAmountNanos <= 0n) {
      setStatus("Invalid amount. Enter an IOTA value greater than 0.");
      return;
    }

    if (!Number.isFinite(dueDateEpochSec) || dueDateEpochSec <= 0) {
      setStatus("Invalid due date.");
      return;
    }

    const { duplicate, error: duplicateError } = await verifyDuplicateHash(pdfHashHex, true);
    if (duplicate) {
      setStatus(
        `Duplicate invoice detected on ${network}: ${duplicate.id}. Reusing the same PDF hash is not allowed on this deploy.`,
      );
      return;
    }

    if (duplicateError) {
      setStatus(
        "Duplicate pre-check unavailable. Continuing with authoritative validation on the selected backend.",
      );
    }

    setNotarizationComplete(false);
    setInvoiceComplete(false);
    setBusy(true);
    setWorkflowPhase("notarizing");
    setStatus("Preparing notarization...");

    try {
      const {
        buildCreateInvoiceSimulationTx,
        buildCreateInvoiceTx,
        buildInvoiceNotarizationMetadata,
        buildLockedNotarizationTx,
        fetchNotarizationById,
        fetchRegistryId,
        hexToBytes,
      } = await loadCreateSubmissionRuntime();

      if (!packageId) {
        const timestamp = Date.now();
        const fallbackId = `local-${timestamp}`;
        const record: InvoiceRecord = {
          id: fallbackId,
          network,
          packageId,
          registryId: null,
          notarizationId: `local-notarization-${timestamp}`,
          notarizationMethod: "Locked",
          notarizationPackageId: null,
          notarizationCreatedAtMs: timestamp,
          invoiceHashHex: pdfHashHex,
          amountNanos: parsedAmountNanos.toString(),
          dueDateEpochSec,
          issuer: accountAddress,
          holder: null,
          discountPriceNanos: null,
          ratingScore: null,
          ratedBy: null,
          status: "OPEN",
          lifecycleMode,
          wasDefaulted: false,
          fundedAtMs: null,
          defaultedAtMs: null,
          recoveredAtMs: null,
        };

        upsertInvoice(storageScope, record);
        setNotarizationComplete(true);
        setInvoiceComplete(true);
        setWorkflowPhase("completed");
        setStatus(`Package ID missing on ${network}. Saved invoice locally for demo flow.`);
        return;
      }

      if (!notarizationPackageId) {
        throw new Error(
          `Notarization package ID missing on ${network}. On-chain create now requires the matching deployed notarization package.`,
        );
      }

      const notarizationStateBytes = hexToBytes(pdfHashHex);
      const notarizationMetadata = buildInvoiceNotarizationMetadata({
        mimeType: file.type,
        sizeBytes: file.size,
      });

      const notarizationTx = await buildLockedNotarizationTx({
        iotaClient,
        notarizationPackageId,
        stateBytes: notarizationStateBytes,
        stateMetadata: INVOICE_NOTARIZATION_STATE_METADATA,
        immutableDescription: INVOICE_NOTARIZATION_DESCRIPTION,
        updatableMetadata: notarizationMetadata,
      });

      setStatus("Waiting for wallet confirmation for notarization...");
      const notarizationResult = await signAndExecute({ transaction: notarizationTx.transaction });
      const notarizationSettled = await waitForSuccessfulTransaction({
        iotaClient,
        digest: notarizationResult.digest,
        actionLabel: "Notarization",
        options: {
          showEvents: true,
          showObjectChanges: true,
        },
      });

      const notarization = await notarizationTx.extractNotarization(notarizationSettled);
      if (!notarization) {
        throw new Error(
          "Notarization completed, but the created notarization object could not be resolved.",
        );
      }

      const notarizationSnapshot = await fetchNotarizationById({
        iotaClient,
        notarizationId: notarization.id,
        notarizationPackageId: notarization.packageId,
      });

      if (notarizationSnapshot.stateMetadata !== INVOICE_NOTARIZATION_STATE_METADATA) {
        throw new Error("Unexpected notarization state schema for the created invoice hash anchor.");
      }

      if (!bytesEqual(notarizationSnapshot.stateBytes, notarizationStateBytes)) {
        throw new Error("Notarization payload mismatch: the notarized bytes do not match the PDF SHA-256 hash.");
      }

      if (notarizationSnapshot.updatableMetadata !== notarizationMetadata) {
        throw new Error("Notarization metadata mismatch: the stored invoice metadata does not match the submitted PDF metadata.");
      }

      if (notarizationSnapshot.description !== INVOICE_NOTARIZATION_DESCRIPTION) {
        throw new Error("Unexpected notarization description for the created invoice hash anchor.");
      }

      setNotarizationComplete(true);
      setWorkflowPhase("creating");

      const registryId = await fetchRegistryId(iotaClient, network, packageId);
      if (!registryId) {
        throw new Error("Invoice registry not found for the current package.");
      }

      setStatus("Waiting for wallet confirmation for invoice creation...");
      const invoiceTx = isDefaultSimulation
        ? buildCreateInvoiceSimulationTx(
            packageId,
            registryId,
            notarization.id,
            pdfHashHex,
            parsedAmountNanos,
            dueDateEpochSec,
          )
        : buildCreateInvoiceTx(
            packageId,
            registryId,
            notarization.id,
            pdfHashHex,
            parsedAmountNanos,
            dueDateEpochSec,
          );

      const invoiceResult = await signAndExecute({ transaction: invoiceTx });
      const invoiceSettled = await waitForSuccessfulTransaction({
        iotaClient,
        digest: invoiceResult.digest,
        actionLabel: "Invoice creation",
        options: { showObjectChanges: true },
      });

      const createdObjectChange = invoiceSettled.objectChanges?.find(
        (item) =>
          item.type === "created" &&
          "objectType" in item &&
          typeof item.objectType === "string" &&
          item.objectType.includes("::invoice_vault::Invoice"),
      );
      const createdId =
        createdObjectChange &&
        "objectId" in createdObjectChange &&
        typeof createdObjectChange.objectId === "string"
          ? createdObjectChange.objectId
          : invoiceSettled.effects?.created?.[0]?.reference?.objectId;

      if (!createdId) {
        setInvoiceComplete(true);
        setWorkflowPhase("completed");
        setStatus(
          `Invoice transaction submitted on ${network}: ${invoiceResult.digest}. Refresh Portfolio shortly if indexing is delayed.`,
        );
        return;
      }

        const record: InvoiceRecord = {
          id: createdId,
          network,
        packageId,
        registryId,
        notarizationId: notarization.id,
        notarizationMethod: notarization.method,
        notarizationPackageId: notarization.packageId,
        notarizationCreatedAtMs: notarization.createdAtMs,
          invoiceHashHex: pdfHashHex,
          amountNanos: parsedAmountNanos.toString(),
          dueDateEpochSec,
          issuer: accountAddress,
          holder: null,
        discountPriceNanos: null,
        ratingScore: null,
        ratedBy: null,
        status: "OPEN",
        createDigest: invoiceResult.digest,
        notarizationDigest: notarizationResult.digest,
        lifecycleMode,
        wasDefaulted: false,
        fundedAtMs: null,
        defaultedAtMs: null,
        recoveredAtMs: null,
      };

      upsertInvoice(storageScope, record);
      setInvoiceComplete(true);
      setWorkflowPhase("completed");
      setStatus(
        `Invoice created on-chain: ${createdId}. Notarization ${notarization.id} recorded first.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setWorkflowPhase("failed");
      setStatus(`On-chain submission failed on ${network}: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  const hashStepTone: StepTone = pdfHashHex
    ? "complete"
    : workflowPhase === "hashing"
      ? "active"
      : file
        ? "active"
        : "pending";
  const duplicateStepTone: StepTone = duplicateRecord
    ? "blocked"
    : duplicateCheckError
      ? "warning"
      : pdfHashHex && !duplicateCheckBusy
        ? "complete"
        : duplicateCheckBusy || workflowPhase === "duplicate-check"
          ? "active"
          : "pending";
  const notarizeStepTone: StepTone = notarizationComplete
    ? "complete"
    : workflowPhase === "notarizing"
      ? "active"
      : "pending";
  const createStepTone: StepTone = invoiceComplete
    ? "complete"
    : workflowPhase === "creating"
      ? "active"
      : "pending";
  return (
    <section className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div
          className="panel space-y-5 px-6 py-5 sm:px-7"
          aria-busy={busy || duplicateCheckBusy || recordsFetching}
        >
          <div className="flex flex-col gap-4">
            <div className="max-w-3xl">
              <p className="eyebrow">Notarized Invoice Minting</p>
              <h1 className="mt-2 text-[clamp(2rem,4vw,3.4rem)] font-semibold tracking-[-0.06em] text-white">
                Mint a claim fast, with the proof path still visible.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Load the PDF, set amount and due date, hash once to clear duplicate risk, then
                submit the notarization and mint sequence from the same rail.
              </p>
            </div>
          </div>

          <QuickAccessStrip
            summary="Skip the framing and land on the exact rail you need: inputs, execution controls or live submission feedback."
            items={[
              {
                href: "#launch-form",
                kicker: "Start here",
                title: "Invoice inputs",
                detail: "Choose the PDF, enter amount and due date, then prepare the hash.",
                badge: file ? "Loaded" : "Step 1",
                emphasis: !file,
              },
              {
                href: "#launch-actions",
                kicker: "Execute",
                title: "Hash and create",
                detail: "Jump straight to the action row once the document and fields are ready.",
                badge: canShowSubmit ? "Ready" : "Pending",
                emphasis: canShowSubmit,
              },
              {
                href: "#launch-status",
                kicker: "Monitor",
                title: "Live status",
                detail: "Keep the hash fingerprint, wallet state and transaction feedback in view.",
                badge: status ? "Active" : "Idle",
              },
            ]}
          />

          <div id="launch-guide" className="scroll-mt-[11rem] rounded-[24px] border border-white/10 bg-white/4 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="metric-label">Operator Guide</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  1. Choose the PDF. 2. Enter amount and due date. 3. Hash to verify the
                  active deploy is clean. 4. Create only after the status rail is clear.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { title: "Hash", tone: hashStepTone },
                  { title: "Duplicate Check", tone: duplicateStepTone },
                  { title: "Notarize", tone: notarizeStepTone },
                  { title: "Create", tone: createStepTone },
                ].map((step) => (
                  <div
                    key={step.title}
                    className={`rounded-full border px-3 py-2 text-xs ${stepClasses(step.tone)}`}
                  >
                    <span className="font-semibold uppercase tracking-[0.12em]">
                      {step.title}
                    </span>
                    <span className="ml-2 text-[11px]">{stepLabel(step.tone)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-500/8 px-4 py-4 text-sm leading-6 text-cyan-100">
            The notarization stores the PDF SHA-256 bytes plus lightweight metadata
            (`mimeType`, `sizeBytes`), not the raw PDF body. Duplicate protection stays scoped
            to the active deployed package in this MVP.
          </div>

          {packageId && !notarizationPackageId ? (
            <div className="rounded-[24px] border border-red-300/35 bg-red-500/10 px-4 py-4 text-sm leading-6 text-red-100">
              On-chain create is disabled on {network} until a matching notarization package ID
              is configured for this deployment.
            </div>
          ) : null}

          <label id="launch-form" className="block scroll-mt-40 space-y-3">
            <span className="text-sm font-semibold text-slate-200">Invoice PDF</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
            <div
              className={`field-shell flex items-center gap-3 px-3 py-3 ${
                file ? "border-white/12" : "border-red-400/70"
              }`}
            >
              <button
                type="button"
                className="btn-secondary shrink-0 px-4 py-2.5"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </button>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Document input
                </p>
                <p className="mt-1 truncate text-sm text-slate-200">
                  {file ? file.name : "No file selected"}
                </p>
              </div>
            </div>
          </label>

          <div id="launch-entry" className="grid scroll-mt-[11rem] gap-4 sm:grid-cols-2">
            <label className="block space-y-3">
              <span className="text-sm font-semibold text-slate-200">Amount (IOTA)</span>
              <div
                className={`field-shell px-3 py-3 ${
                  isAmountValid ? "border-white/12" : "border-red-400/70"
                }`}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="e.g. 1250.5"
                  className="w-full bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500"
                />
              </div>
            </label>
            <label className="block space-y-3">
              <span className="text-sm font-semibold text-slate-200">Due Date</span>
              <div
                className={`field-shell px-3 py-3 ${
                  hasDueDate ? "border-white/12" : "border-red-400/70"
                }`}
              >
                <input
                  ref={dueDateInputRef}
                  type="date"
                  min={formatLocalDateInputValue()}
                  value={dueDate}
                  disabled={isDefaultSimulation}
                  onPointerDown={() => {
                    try {
                      dueDateInputRef.current?.showPicker?.();
                    } catch {
                      // Browsers without showPicker() support fall back to native behavior.
                    }
                  }}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full bg-transparent text-base text-slate-100 outline-none"
                />
              </div>
              {isDefaultSimulation ? (
                <p className="text-xs leading-5 text-amber-200">
                  Default Simulation active: due date is set automatically at funding (+30s).
                </p>
              ) : null}
            </label>
          </div>

          {duplicateRecord ? (
            <div className="rounded-[24px] border border-red-300/35 bg-red-500/10 px-4 py-4 text-sm leading-6 text-red-100">
              Duplicate detected: invoice <span className="font-mono">{duplicateRecord.id}</span>{" "}
              already uses this PDF hash on the active deploy.
            </div>
          ) : null}

          {duplicateCheckError ? (
            <div className="rounded-[24px] border border-amber-300/30 bg-amber-500/10 px-4 py-4 text-sm leading-6 text-amber-100">
              Duplicate pre-check unavailable: {duplicateCheckError}. On-chain mode will still
              enforce the contract-level duplicate guard.
            </div>
          ) : null}

          <div id="launch-actions" className="scroll-mt-40 flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              onClick={() => void onHash()}
              disabled={!file || busy || duplicateCheckBusy || Boolean(pdfHashHex)}
            >
              Hash PDF
            </button>
            {canShowSubmit ? (
              <button
                className="btn"
                onClick={() => void onCreate()}
                disabled={
                  busy ||
                  duplicateCheckBusy ||
                  recordsFetching ||
                  !accountAddress ||
                  Boolean(duplicateRecord) ||
                  (Boolean(packageId) && !notarizationPackageId)
                }
              >
                Create notarized invoice
              </button>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-32 xl:self-start">
          <div id="launch-status" className="panel-strong scroll-mt-40 px-5 py-5">
            <p className="eyebrow">Live Status</p>
            <div
              aria-live="polite"
              role="status"
              className="mt-4 rounded-[22px] border border-white/10 bg-white/4 px-4 py-4 text-sm leading-6 text-cyan-100"
            >
              {status || "Waiting for input."}
            </div>
            <div className="mt-4 grid gap-3">
              <div className="metric-card px-4 py-4">
                <p className="metric-label">Hash Fingerprint</p>
                <p className="mt-3 break-all font-mono text-xs leading-6 text-slate-200">
                  {pdfHashHex || "Hash not computed yet."}
                </p>
              </div>
              <div className="metric-card px-4 py-4">
                <p className="metric-label">Wallet State</p>
                <p className="mt-3 text-sm font-semibold text-slate-100">
                  {accountAddress ? "Wallet connected" : "Connect wallet to sign"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Signing is required for notarization and on-chain invoice creation.
                </p>
              </div>
            </div>
          </div>

          <div className="panel-muted px-5 py-5">
            <p className="eyebrow">Flow Notes</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>
                The PDF hash is authoritative. Notarization binds the bytes, metadata and
                package pairing before the invoice object is minted.
              </p>
              <p>
                Switching package scope changes duplicate semantics for this MVP, so this page
                keeps scope visibility prominent throughout the flow.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
