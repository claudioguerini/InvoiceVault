import { describe, expect, it } from "vitest";
import {
  buildSellerRatings,
  computeAverageSellerRatingForRecords,
} from "@/lib/invoice-analytics";
import type { InvoiceRecord } from "@/lib/invoice-store";

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: `0x${"1".repeat(64)}`,
    network: "devnet",
    packageId: `0x${"2".repeat(64)}`,
    registryId: `0x${"3".repeat(64)}`,
    notarizationId: `0x${"4".repeat(64)}`,
    notarizationMethod: "Locked",
    notarizationPackageId: `0x${"5".repeat(64)}`,
    notarizationCreatedAtMs: 1,
    invoiceHashHex: "abcdef",
    amountNanos: "1000",
    dueDateEpochSec: 1_700_000_000,
    issuer: `0x${"6".repeat(64)}`,
    holder: `0x${"7".repeat(64)}`,
    discountPriceNanos: "900",
    ratingScore: null,
    ratedBy: null,
    status: "FUNDED",
    lifecycleMode: "NORMAL",
    wasDefaulted: false,
    fundedAtMs: null,
    defaultedAtMs: null,
    recoveredAtMs: null,
    ...overrides,
  };
}

describe("invoice analytics", () => {
  it("computes buyer counterparty rating from the sellers in bought positions", () => {
    const buyer = `0x${"9".repeat(64)}`;
    const sellerA = `0x${"a".repeat(64)}`;
    const sellerB = `0x${"b".repeat(64)}`;
    const allRecords = [
      makeRecord({
        id: `0x${"c".repeat(64)}`,
        issuer: sellerA,
        holder: buyer,
        status: "REPAID",
        ratingScore: 5,
      }),
      makeRecord({
        id: `0x${"d".repeat(64)}`,
        issuer: sellerB,
        holder: buyer,
        status: "RECOVERED",
        ratingScore: 3,
      }),
      makeRecord({
        id: `0x${"e".repeat(64)}`,
        issuer: `0x${"f".repeat(64)}`,
        holder: `0x${"8".repeat(64)}`,
        status: "REPAID",
        ratingScore: 1,
      }),
    ];

    const ratings = buildSellerRatings(allRecords);
    const buyerStats = computeAverageSellerRatingForRecords(
      allRecords.filter((item) => item.holder === buyer),
      ratings,
    );

    expect(buyerStats.count).toBe(2);
    expect(buyerStats.avg).toBe(4);
  });
});
