import { nanoStringToBigInt, toNanoString } from "@/lib/iota-amount";
import {
  normalizeIotaAddressValue,
  normalizeIotaObjectIdValue,
} from "@/lib/iota-ids";

export type InvoiceStatus =
  | "OPEN"
  | "FUNDED"
  | "REPAID"
  | "CANCELLED"
  | "DEFAULTED"
  | "RECOVERED";

export type LifecycleMode = "NORMAL" | "DEFAULT_SIMULATION";

export type StorageScope = {
  network: string;
  packageId?: string | null;
};

export const DEFAULT_SIMULATION_DUE_OFFSET_SEC = 30;
export const BPS_DENOMINATOR = 10000n;
export const DEFAULT_FEE_BPS = 800n;
export const LIFECYCLE_MODE_EVENT = "invoicevault:lifecycle-mode-changed";
export const INVOICE_STORE_EVENT = "invoicevault:invoice-store-changed";

export type InvoiceRecord = {
  id: string;
  network: string;
  packageId?: string;
  registryId?: string | null;
  notarizationId?: string | null;
  notarizationMethod?: "Locked" | "Dynamic" | null;
  notarizationPackageId?: string | null;
  notarizationCreatedAtMs?: number | null;
  invoiceHashHex: string;
  amountNanos: string;
  dueDateEpochSec: number;
  issuer: string;
  holder: string | null;
  discountPriceNanos: string | null;
  ratingScore?: number | null;
  ratedBy?: string | null;
  status: InvoiceStatus;
  createDigest?: string;
  notarizationDigest?: string;
  listDigest?: string;
  fundDigest?: string;
  cancelDigest?: string;
  repayDigest?: string;
  defaultDigest?: string;
  rateDigest?: string;
  lifecycleMode?: LifecycleMode;
  wasDefaulted?: boolean;
  fundedAtMs?: number | null;
  defaultedAtMs?: number | null;
  recoveredAtMs?: number | null;
  autoDefaultRating?: boolean;
};

const STORAGE_VERSION = "v2";
const RECORDS_STORAGE_KEY = `invoice-vault-records-${STORAGE_VERSION}`;
const HIDDEN_STORAGE_KEY = `invoice-vault-hidden-${STORAGE_VERSION}`;
const PORTFOLIO_HIDE_ALL_PENDING_KEY = `invoice-vault-portfolio-hide-all-pending-${STORAGE_VERSION}`;
const LIFECYCLE_MODE_KEY = "invoice-vault-lifecycle-mode-v1";

function isBrowser() {
  return typeof window !== "undefined";
}

function scopedKey(base: string, scope: StorageScope) {
  const packageFragment = normalizeIotaObjectIdValue(scope.packageId) ?? "local";
  return `${base}:${scope.network}:${packageFragment}`;
}

function emitInvoiceStoreEvent(scope: StorageScope, reason: string) {
  if (!isBrowser()) return;

  window.dispatchEvent(
    new CustomEvent(INVOICE_STORE_EVENT, {
      detail: {
        scopeKey: scopedKey("scope", scope),
        reason,
      },
    }),
  );
}

function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return (
    value === "OPEN" ||
    value === "FUNDED" ||
    value === "REPAID" ||
    value === "CANCELLED" ||
    value === "DEFAULTED" ||
    value === "RECOVERED"
  );
}

function normalizeInvoiceRecord(record: unknown, scope?: StorageScope): InvoiceRecord | null {
  if (!record || typeof record !== "object") return null;

  const candidate = record as Partial<InvoiceRecord> & {
    amount?: number | string;
    discountPrice?: number | string | null;
  };

  const network = candidate.network?.trim() ?? scope?.network?.trim();
  const packageId = normalizeIotaObjectIdValue(candidate.packageId ?? scope?.packageId) ?? undefined;
  const amountNanos = candidate.amountNanos ?? candidate.amount;
  const issuer = normalizeIotaAddressValue(candidate.issuer);

  if (
    !network ||
    typeof candidate.id !== "string" ||
    typeof candidate.invoiceHashHex !== "string" ||
    !issuer ||
    typeof candidate.dueDateEpochSec !== "number" ||
    !Number.isFinite(candidate.dueDateEpochSec) ||
    !isInvoiceStatus(candidate.status) ||
    amountNanos === undefined
  ) {
    return null;
  }

  return {
    id: normalizeIotaObjectIdValue(candidate.id) ?? candidate.id.trim().toLowerCase(),
    network,
    packageId,
    registryId:
      normalizeIotaObjectIdValue(
        typeof candidate.registryId === "string" ? candidate.registryId : null,
      ) ?? null,
    notarizationId:
      normalizeIotaObjectIdValue(
        typeof candidate.notarizationId === "string" ? candidate.notarizationId : null,
      ) ?? null,
    notarizationMethod:
      candidate.notarizationMethod === "Locked" || candidate.notarizationMethod === "Dynamic"
        ? candidate.notarizationMethod
        : null,
    notarizationPackageId:
      normalizeIotaObjectIdValue(
        typeof candidate.notarizationPackageId === "string"
          ? candidate.notarizationPackageId
          : null,
      ) ?? null,
    notarizationCreatedAtMs:
      typeof candidate.notarizationCreatedAtMs === "number"
        ? candidate.notarizationCreatedAtMs
        : null,
    invoiceHashHex: candidate.invoiceHashHex,
    amountNanos: toNanoString(amountNanos),
    dueDateEpochSec: candidate.dueDateEpochSec,
    issuer,
    holder:
      normalizeIotaAddressValue(typeof candidate.holder === "string" ? candidate.holder : null) ??
      null,
    discountPriceNanos:
      candidate.discountPriceNanos !== undefined && candidate.discountPriceNanos !== null
        ? toNanoString(candidate.discountPriceNanos)
        : candidate.discountPrice !== undefined && candidate.discountPrice !== null
          ? toNanoString(candidate.discountPrice)
          : null,
    ratingScore: typeof candidate.ratingScore === "number" ? candidate.ratingScore : null,
    ratedBy:
      normalizeIotaAddressValue(typeof candidate.ratedBy === "string" ? candidate.ratedBy : null) ??
      null,
    status: candidate.status,
    createDigest: typeof candidate.createDigest === "string" ? candidate.createDigest : undefined,
    notarizationDigest:
      typeof candidate.notarizationDigest === "string" ? candidate.notarizationDigest : undefined,
    listDigest: typeof candidate.listDigest === "string" ? candidate.listDigest : undefined,
    fundDigest: typeof candidate.fundDigest === "string" ? candidate.fundDigest : undefined,
    cancelDigest: typeof candidate.cancelDigest === "string" ? candidate.cancelDigest : undefined,
    repayDigest: typeof candidate.repayDigest === "string" ? candidate.repayDigest : undefined,
    defaultDigest: typeof candidate.defaultDigest === "string" ? candidate.defaultDigest : undefined,
    rateDigest: typeof candidate.rateDigest === "string" ? candidate.rateDigest : undefined,
    lifecycleMode:
      candidate.lifecycleMode === "DEFAULT_SIMULATION" ? "DEFAULT_SIMULATION" : "NORMAL",
    wasDefaulted: candidate.wasDefaulted === true,
    fundedAtMs: typeof candidate.fundedAtMs === "number" ? candidate.fundedAtMs : null,
    defaultedAtMs: typeof candidate.defaultedAtMs === "number" ? candidate.defaultedAtMs : null,
    recoveredAtMs: typeof candidate.recoveredAtMs === "number" ? candidate.recoveredAtMs : null,
    autoDefaultRating: candidate.autoDefaultRating === true,
  };
}

export function loadInvoices(scope: StorageScope): InvoiceRecord[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(scopedKey(RECORDS_STORAGE_KEY, scope));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeInvoiceRecord(item, scope))
      .filter((item): item is InvoiceRecord => Boolean(item));
  } catch {
    return [];
  }
}

export function saveInvoices(scope: StorageScope, items: InvoiceRecord[]) {
  if (!isBrowser()) return;
  const normalizedItems = items
    .map((item) => normalizeInvoiceRecord(item, scope))
    .filter((item): item is InvoiceRecord => Boolean(item));
  window.localStorage.setItem(
    scopedKey(RECORDS_STORAGE_KEY, scope),
    JSON.stringify(normalizedItems),
  );
  emitInvoiceStoreEvent(scope, "records:saved");
}

export function clearInvoices(scope: StorageScope) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(scopedKey(RECORDS_STORAGE_KEY, scope));
  emitInvoiceStoreEvent(scope, "records:cleared");
}

export function loadHiddenInvoiceIds(scope: StorageScope): string[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(scopedKey(HIDDEN_STORAGE_KEY, scope));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeIotaObjectIdValue(item) ?? item.trim().toLowerCase());
  } catch {
    return [];
  }
}

export function saveHiddenInvoiceIds(scope: StorageScope, ids: string[]) {
  if (!isBrowser()) return;
  const unique = [
    ...new Set(
      ids
        .map((id) => normalizeIotaObjectIdValue(id) ?? id.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  window.localStorage.setItem(scopedKey(HIDDEN_STORAGE_KEY, scope), JSON.stringify(unique));
  emitInvoiceStoreEvent(scope, "hidden:saved");
}

export function hideInvoiceIds(scope: StorageScope, ids: string[]) {
  const current = loadHiddenInvoiceIds(scope);
  saveHiddenInvoiceIds(scope, [...current, ...ids]);
}

export function clearHiddenInvoiceIds(scope: StorageScope) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(scopedKey(HIDDEN_STORAGE_KEY, scope));
  emitInvoiceStoreEvent(scope, "hidden:cleared");
}

export function isPortfolioHideAllPending(scope: StorageScope) {
  if (!isBrowser()) return false;
  return window.localStorage.getItem(scopedKey(PORTFOLIO_HIDE_ALL_PENDING_KEY, scope)) === "1";
}

export function setPortfolioHideAllPending(scope: StorageScope, value: boolean) {
  if (!isBrowser()) return;
  const key = scopedKey(PORTFOLIO_HIDE_ALL_PENDING_KEY, scope);
  if (value) {
    window.localStorage.setItem(key, "1");
  } else {
    window.localStorage.removeItem(key);
  }
  emitInvoiceStoreEvent(scope, value ? "hide-all:enabled" : "hide-all:cleared");
}

export function upsertInvoice(scope: StorageScope, next: InvoiceRecord) {
  const normalizedNext = normalizeInvoiceRecord(next, scope);
  if (!normalizedNext) return;
  const records = loadInvoices(scope);
  const existingIndex = records.findIndex((item) => item.id === normalizedNext.id);
  if (existingIndex === -1) {
    records.unshift(normalizedNext);
  } else {
    records[existingIndex] = normalizedNext;
  }
  saveInvoices(scope, records);
}

export function updateInvoices(
  scope: StorageScope,
  updater: (records: InvoiceRecord[]) => InvoiceRecord[],
) {
  const next = updater(loadInvoices(scope));
  saveInvoices(scope, next);
  return next;
}

export function clearScopeUiState(scope: StorageScope) {
  if (!isBrowser()) return;

  window.localStorage.removeItem(scopedKey(RECORDS_STORAGE_KEY, scope));
  window.localStorage.removeItem(scopedKey(HIDDEN_STORAGE_KEY, scope));
  window.localStorage.removeItem(scopedKey(PORTFOLIO_HIDE_ALL_PENDING_KEY, scope));
  emitInvoiceStoreEvent(scope, "scope:cleared");
}

export function normalizeInvoiceHashHex(value: string) {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

export function findInvoiceByHash(records: InvoiceRecord[], invoiceHashHex: string) {
  const normalizedHash = normalizeInvoiceHashHex(invoiceHashHex);
  if (!normalizedHash) return null;

  return (
    records.find(
      (item) =>
        item.status !== "CANCELLED" &&
        normalizeInvoiceHashHex(item.invoiceHashHex) === normalizedHash,
    ) ?? null
  );
}

export function parseAddressList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => normalizeIotaAddressValue(item) ?? "")
    .filter(Boolean);
}

export function canWalletFund(address: string | null | undefined) {
  if (!address) return false;
  const normalizedAddress = normalizeIotaAddressValue(address);
  if (!normalizedAddress) return false;
  const allowlist = parseAddressList(process.env.NEXT_PUBLIC_ALLOWLIST);
  const denylist = parseAddressList(process.env.NEXT_PUBLIC_DENYLIST);
  const inAllowlist = allowlist.length === 0 || allowlist.includes(normalizedAddress);
  const inDenylist = denylist.includes(normalizedAddress);
  return inAllowlist && !inDenylist;
}

export function isTerminalStatus(status: InvoiceStatus) {
  return (
    status === "CANCELLED" ||
    status === "REPAID" ||
    status === "DEFAULTED" ||
    status === "RECOVERED"
  );
}

export function loadLifecycleMode(): LifecycleMode {
  if (!isBrowser()) return "NORMAL";
  return window.localStorage.getItem(LIFECYCLE_MODE_KEY) === "DEFAULT_SIMULATION"
    ? "DEFAULT_SIMULATION"
    : "NORMAL";
}

export function saveLifecycleMode(mode: LifecycleMode) {
  if (!isBrowser()) return;
  if (mode === "DEFAULT_SIMULATION") {
    window.localStorage.setItem(LIFECYCLE_MODE_KEY, mode);
  } else {
    window.localStorage.removeItem(LIFECYCLE_MODE_KEY);
  }
  window.dispatchEvent(new Event(LIFECYCLE_MODE_EVENT));
}

export function computeDefaultRepayAmount(amountNanos: bigint | string) {
  const amount = nanoStringToBigInt(amountNanos);
  const feeAmount = (amount * DEFAULT_FEE_BPS) / BPS_DENOMINATOR;
  return amount + feeAmount;
}
