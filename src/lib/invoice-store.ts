export type InvoiceStatus =
  | "OPEN"
  | "FUNDED"
  | "REPAID"
  | "CANCELLED"
  | "DEFAULTED"
  | "RECOVERED";

export type LifecycleMode = "NORMAL" | "DEFAULT_SIMULATION";

export const DEFAULT_SIMULATION_DUE_OFFSET_SEC = 30;
export const BPS_DENOMINATOR = 10000;
export const DEFAULT_FEE_BPS = 800;
export const LIFECYCLE_MODE_EVENT = "invoicevault:lifecycle-mode-changed";

export type InvoiceRecord = {
  id: string;
  packageId?: string;
  invoiceHashHex: string;
  amount: number;
  dueDateEpochSec: number;
  issuer: string;
  holder: string | null;
  discountPrice: number | null;
  ratingScore?: number | null;
  ratedBy?: string | null;
  status: InvoiceStatus;
  createDigest?: string;
  fundDigest?: string;
  repayDigest?: string;
  lifecycleMode?: LifecycleMode;
  wasDefaulted?: boolean;
  fundedAtMs?: number | null;
  defaultedAtMs?: number | null;
  recoveredAtMs?: number | null;
  autoDefaultRating?: boolean;
};

const STORAGE_KEY = "invoice-vault-records-v1";
const HIDDEN_STORAGE_KEY = "invoice-vault-hidden-v1";
const PORTFOLIO_HIDE_ALL_PENDING_KEY = "invoice-vault-portfolio-hide-all-pending-v1";
const LIFECYCLE_MODE_KEY = "invoice-vault-lifecycle-mode-v1";

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadInvoices(): InvoiceRecord[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as InvoiceRecord[];
  } catch {
    return [];
  }
}

export function saveInvoices(items: InvoiceRecord[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function clearInvoices() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function loadHiddenInvoiceIds(): string[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function saveHiddenInvoiceIds(ids: string[]) {
  if (!isBrowser()) return;
  const unique = [...new Set(ids)];
  window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(unique));
}

export function hideInvoiceIds(ids: string[]) {
  const current = loadHiddenInvoiceIds();
  saveHiddenInvoiceIds([...current, ...ids]);
}

export function clearHiddenInvoiceIds() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(HIDDEN_STORAGE_KEY);
}

export function isPortfolioHideAllPending() {
  if (!isBrowser()) return false;
  return window.localStorage.getItem(PORTFOLIO_HIDE_ALL_PENDING_KEY) === "1";
}

export function setPortfolioHideAllPending(value: boolean) {
  if (!isBrowser()) return;
  if (value) {
    window.localStorage.setItem(PORTFOLIO_HIDE_ALL_PENDING_KEY, "1");
  } else {
    window.localStorage.removeItem(PORTFOLIO_HIDE_ALL_PENDING_KEY);
  }
}

export function upsertInvoice(next: InvoiceRecord) {
  const records = loadInvoices();
  const existingIndex = records.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    records.unshift(next);
  } else {
    records[existingIndex] = next;
  }
  saveInvoices(records);
}

export function parseAddressList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function canWalletFund(address: string | null | undefined) {
  if (!address) return false;
  const allowlist = parseAddressList(process.env.NEXT_PUBLIC_ALLOWLIST);
  const denylist = parseAddressList(process.env.NEXT_PUBLIC_DENYLIST);
  const inAllowlist = allowlist.length === 0 || allowlist.includes(address);
  const inDenylist = denylist.includes(address);
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

export function computeDefaultRepayAmount(amount: number) {
  const feeAmount = Math.floor((amount * DEFAULT_FEE_BPS) / BPS_DENOMINATOR);
  return amount + feeAmount;
}
