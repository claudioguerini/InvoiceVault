import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canWalletFund,
  clearScopeUiState,
  findInvoiceByHash,
  isPortfolioHideAllPending,
  loadHiddenInvoiceIds,
  loadInvoices,
  saveHiddenInvoiceIds,
  saveInvoices,
  setPortfolioHideAllPending,
  type InvoiceRecord,
  type StorageScope,
} from "@/lib/invoice-store";

const scope: StorageScope = {
  network: "devnet",
  packageId: "0xabc",
};

const baseRecord: InvoiceRecord = {
  id: "0xinvoice",
  network: "devnet",
  packageId: "0xabc",
  registryId: "0xregistry",
  notarizationId: "0xnotarization",
  notarizationMethod: "Locked",
  notarizationPackageId: "0xnotary",
  notarizationCreatedAtMs: 1,
  invoiceHashHex: "abcdef",
  amountNanos: "1000",
  dueDateEpochSec: 1_700_000_000,
  issuer: `0x${"1".repeat(64)}`,
  holder: null,
  discountPriceNanos: null,
  ratingScore: null,
  ratedBy: null,
  status: "OPEN",
  lifecycleMode: "NORMAL",
  wasDefaulted: false,
  fundedAtMs: null,
  defaultedAtMs: null,
  recoveredAtMs: null,
};

describe("invoice-store", () => {
  const previousAllowlist = process.env.NEXT_PUBLIC_ALLOWLIST;
  const previousDenylist = process.env.NEXT_PUBLIC_DENYLIST;

  beforeEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_ALLOWLIST;
    delete process.env.NEXT_PUBLIC_DENYLIST;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ALLOWLIST = previousAllowlist;
    process.env.NEXT_PUBLIC_DENYLIST = previousDenylist;
  });

  it("normalizes allowlist and denylist addresses before funding checks", () => {
    const allowed = `0x${"a".repeat(64)}`;
    const denied = `0x${"b".repeat(64)}`;

    process.env.NEXT_PUBLIC_ALLOWLIST = allowed.toUpperCase();
    process.env.NEXT_PUBLIC_DENYLIST = denied.toUpperCase();

    expect(canWalletFund(allowed)).toBe(true);
    expect(canWalletFund(allowed.toUpperCase())).toBe(true);
    expect(canWalletFund(denied)).toBe(false);
  });

  it("clears scoped invoices, hidden ids and hide-all flags together", () => {
    saveInvoices(scope, [baseRecord]);
    saveHiddenInvoiceIds(scope, [baseRecord.id]);
    setPortfolioHideAllPending(scope, true);

    clearScopeUiState(scope);

    expect(loadInvoices(scope)).toEqual([]);
    expect(loadHiddenInvoiceIds(scope)).toEqual([]);
    expect(isPortfolioHideAllPending(scope)).toBe(false);
  });

  it("finds duplicate hashes regardless of 0x prefix or case", () => {
    expect(findInvoiceByHash([baseRecord], "0xABCDEF")?.id).toBe(baseRecord.id);
    expect(findInvoiceByHash([baseRecord], "abcdef")?.id).toBe(baseRecord.id);
    expect(findInvoiceByHash([baseRecord], "0xdeadbeef")).toBeNull();
  });

  it("ignores cancelled invoices when checking hash reuse", () => {
    expect(
      findInvoiceByHash(
        [
          {
            ...baseRecord,
            id: "0xcancelled",
            status: "CANCELLED",
          },
        ],
        "0xABCDEF",
      ),
    ).toBeNull();

    expect(
      findInvoiceByHash(
        [
          {
            ...baseRecord,
            id: "0xcancelled",
            status: "CANCELLED",
          },
          {
            ...baseRecord,
            id: "0xopen",
            status: "OPEN",
          },
        ],
        "abcdef",
      )?.id,
    ).toBe("0xopen");
  });

  it("normalizes scoped package ids and wallet addresses when persisting records", () => {
    const mixedScope: StorageScope = {
      network: "devnet",
      packageId: `0x${"A".repeat(64)}`,
    };
    const mixedRecord: InvoiceRecord = {
      ...baseRecord,
      id: `0x${"B".repeat(64)}`,
      packageId: `0x${"A".repeat(64)}`,
      issuer: `0x${"C".repeat(64)}`,
      holder: `0x${"D".repeat(64)}`,
      ratedBy: `0x${"E".repeat(64)}`,
    };

    saveInvoices(mixedScope, [mixedRecord]);

    const [loaded] = loadInvoices({
      network: "devnet",
      packageId: `0x${"a".repeat(64)}`,
    });

    expect(loaded.id).toBe(`0x${"b".repeat(64)}`);
    expect(loaded.packageId).toBe(`0x${"a".repeat(64)}`);
    expect(loaded.issuer).toBe(`0x${"c".repeat(64)}`);
    expect(loaded.holder).toBe(`0x${"d".repeat(64)}`);
    expect(loaded.ratedBy).toBe(`0x${"e".repeat(64)}`);
  });
});
