import type { InvoiceRecord } from "@/lib/invoice-store";
import { normalizeIotaAddressValue } from "@/lib/iota-ids";

export type SellerRatingEntry = {
  invoiceId: string;
  score: number;
  amountNanos: string;
  dueDateEpochSec: number;
  ratedBy: string | null;
  status: InvoiceRecord["status"];
  wasDefaulted: boolean;
};

export type SellerRatingStats = {
  avg: number;
  count: number;
  entries: SellerRatingEntry[];
};

export function sellerRatingsKey(value: string) {
  return normalizeIotaAddressValue(value) ?? value.trim().toLowerCase();
}

export function buildSellerRatings(records: InvoiceRecord[]) {
  const bySeller = new Map<string, SellerRatingStats>();

  for (const item of records) {
    const score = item.ratingScore ?? 0;
    if (!Number.isFinite(score) || score < 1 || score > 5) continue;

    const sellerKey = sellerRatingsKey(item.issuer);
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
      amountNanos: item.amountNanos,
      dueDateEpochSec: item.dueDateEpochSec,
      ratedBy: item.ratedBy ?? null,
      status: item.status,
      wasDefaulted: item.wasDefaulted ?? false,
    });

    bySeller.set(sellerKey, current);
  }

  for (const [, value] of bySeller) {
    value.entries.sort((left, right) => right.dueDateEpochSec - left.dueDateEpochSec);
  }

  return bySeller;
}

export function computeAverageSellerRatingForRecords(
  records: InvoiceRecord[],
  ratings: Map<string, SellerRatingStats>,
) {
  const values = records
    .map((item) => ratings.get(sellerRatingsKey(item.issuer))?.avg ?? null)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (values.length === 0) {
    return {
      avg: 0,
      count: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    avg: total / values.length,
    count: values.length,
  };
}
