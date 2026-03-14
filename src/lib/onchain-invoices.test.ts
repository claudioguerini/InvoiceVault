import type { EventId, IotaClient } from "@iota/iota-sdk/client";
import { describe, expect, it, vi } from "vitest";
import { type InvoiceRecord } from "@/lib/invoice-store";
import { fetchOnchainInvoices, mergeScopedInvoices } from "@/lib/onchain-invoices";

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
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
    ...overrides,
  };
}

describe("mergeScopedInvoices", () => {
  it("keeps optimistic funded state when the chain is still stale", () => {
    vi.spyOn(Date, "now").mockReturnValue(200_000);
    const chain = makeRecord();
    const local = makeRecord({
      status: "FUNDED",
      holder: `0x${"2".repeat(64)}`,
      fundedAtMs: 150_000,
      fundDigest: "0xfund",
    });

    const [merged] = mergeScopedInvoices([local], [chain]);

    expect(merged.status).toBe("FUNDED");
    expect(merged.holder).toBe(local.holder);
    expect(merged.fundDigest).toBe("0xfund");
    expect(merged.fundedAtMs).toBe(150_000);
    vi.restoreAllMocks();
  });

  it("drops stale optimistic funded state once the grace window has passed", () => {
    vi.spyOn(Date, "now").mockReturnValue(400_000);
    const chain = makeRecord();
    const local = makeRecord({
      status: "FUNDED",
      holder: `0x${"2".repeat(64)}`,
      fundedAtMs: 100_000,
      fundDigest: "0xfund",
    });

    const [merged] = mergeScopedInvoices([local], [chain]);

    expect(merged.status).toBe("OPEN");
    expect(merged.holder).toBeNull();
    vi.restoreAllMocks();
  });

  it("preserves local audit trail digests while chain fields catch up", () => {
    const chain = makeRecord({
      status: "OPEN",
      discountPriceNanos: null,
      ratingScore: null,
    });
    const local = makeRecord({
      discountPriceNanos: "900",
      listDigest: "0xlist",
      cancelDigest: "0xcancel",
      defaultDigest: "0xdefault",
      rateDigest: "0xrate",
      ratingScore: 4,
      ratedBy: `0x${"3".repeat(64)}`,
    });

    const [merged] = mergeScopedInvoices([local], [chain]);

    expect(merged.discountPriceNanos).toBe("900");
    expect(merged.listDigest).toBe("0xlist");
    expect(merged.cancelDigest).toBe("0xcancel");
    expect(merged.defaultDigest).toBe("0xdefault");
    expect(merged.rateDigest).toBe("0xrate");
    expect(merged.ratingScore).toBe(4);
    expect(merged.ratedBy).toBe(local.ratedBy);
  });
});

describe("fetchOnchainInvoices", () => {
  it("reuses cached event cursors instead of replaying the full event history", async () => {
    const packageId = `0x${"a".repeat(64)}`;
    const registryId = `0x${"b".repeat(64)}`;
    const invoiceId1 = `0x${"c".repeat(64)}`;
    const invoiceId2 = `0x${"d".repeat(64)}`;
    let invoiceEventQueries = 0;
    let registryEventQueries = 0;

    const firstEventId: EventId = {
      txDigest: "digest-newest",
      eventSeq: "1",
    };
    const secondEventId: EventId = {
      txDigest: "digest-older",
      eventSeq: "0",
    };

    const client = {
      async queryEvents(input: {
        query: { MoveEventType: string };
        cursor?: EventId | null;
      }) {
        if (input.query.MoveEventType.endsWith("::RegistryCreated")) {
          registryEventQueries += 1;
          return {
            data: [
              {
                id: firstEventId,
                packageId,
                parsedJson: { registry_id: registryId },
                sender: `0x${"1".repeat(64)}`,
                transactionModule: "invoice_vault",
                type: `${packageId}::invoice_vault::RegistryCreated`,
                bcs: "",
                bcsEncoding: "base64" as const,
              },
            ],
            hasNextPage: false,
            nextCursor: null,
          };
        }

        invoiceEventQueries += 1;
        if (!input.cursor) {
          return {
            data: [
              {
                id: firstEventId,
                packageId,
                parsedJson: { invoice_id: invoiceId2 },
                sender: `0x${"2".repeat(64)}`,
                transactionModule: "invoice_vault",
                type: `${packageId}::invoice_vault::InvoiceCreated`,
                bcs: "",
                bcsEncoding: "base64" as const,
              },
            ],
            hasNextPage: true,
            nextCursor: firstEventId,
          };
        }

        return {
          data: [
            {
              id: secondEventId,
              packageId,
              parsedJson: { invoice_id: invoiceId1 },
              sender: `0x${"3".repeat(64)}`,
              transactionModule: "invoice_vault",
              type: `${packageId}::invoice_vault::InvoiceCreated`,
              bcs: "",
              bcsEncoding: "base64" as const,
            },
          ],
          hasNextPage: false,
          nextCursor: null,
        };
      },
      async multiGetObjects(input: { ids: string[] }) {
        return input.ids.map((id) => ({
          data: {
            objectId: id,
            owner: { Shared: { initial_shared_version: "1" } },
            content: {
              dataType: "moveObject",
              fields: {
                amount: "1000",
                due_date: 1_700_000_000,
                discount_price: "900",
                rating_score: 0,
                funded_at_ms: 0,
                defaulted_at_ms: 0,
                recovered_at_ms: 0,
                status: 0,
                issuer: `0x${"4".repeat(64)}`,
                simulation_mode: false,
                was_defaulted: false,
                auto_default_rating: false,
                holder: "0x0",
                rated_by: "0x0",
                notarization_id: `0x${"5".repeat(64)}`,
                invoice_hash: new Array(32).fill(1),
              },
            },
          },
        }));
      },
      async queryTransactionBlocks() {
        return {
          data: [],
          hasNextPage: false,
          nextCursor: null,
        };
      },
    } as unknown as IotaClient;

    const firstFetch = await fetchOnchainInvoices(client, "devnet", packageId);
    const secondFetch = await fetchOnchainInvoices(client, "devnet", packageId);

    expect(firstFetch).toHaveLength(2);
    expect(secondFetch).toHaveLength(2);
    expect(invoiceEventQueries).toBe(3);
    expect(registryEventQueries).toBe(1);
  });

  it("backfills repay digests from on-chain transaction history", async () => {
    const packageId = `0x${"a".repeat(64)}`;
    const registryId = `0x${"b".repeat(64)}`;
    const invoiceId = `0x${"c".repeat(64)}`;
    const repayDigest = "digest-repay";

    const client = {
      async queryEvents(input: {
        query: { MoveEventType: string };
      }) {
        if (input.query.MoveEventType.endsWith("::RegistryCreated")) {
          return {
            data: [
              {
                id: { txDigest: "registry-digest", eventSeq: "0" },
                packageId,
                parsedJson: { registry_id: registryId },
                sender: `0x${"1".repeat(64)}`,
                transactionModule: "invoice_vault",
                type: `${packageId}::invoice_vault::RegistryCreated`,
                bcs: "",
                bcsEncoding: "base64" as const,
              },
            ],
            hasNextPage: false,
            nextCursor: null,
          };
        }

        return {
          data: [
            {
              id: { txDigest: "create-digest", eventSeq: "0" },
              packageId,
              parsedJson: { invoice_id: invoiceId },
              sender: `0x${"2".repeat(64)}`,
              transactionModule: "invoice_vault",
              type: `${packageId}::invoice_vault::InvoiceCreated`,
              bcs: "",
              bcsEncoding: "base64" as const,
            },
          ],
          hasNextPage: false,
          nextCursor: null,
        };
      },
      async multiGetObjects(input: { ids: string[] }) {
        return input.ids.map((id) => ({
          data: {
            objectId: id,
            owner: { Shared: { initial_shared_version: "1" } },
            content: {
              dataType: "moveObject",
              fields: {
                amount: "1000",
                due_date: 1_700_000_000,
                discount_price: "900",
                rating_score: 0,
                funded_at_ms: 0,
                defaulted_at_ms: 0,
                recovered_at_ms: 1,
                status: 5,
                issuer: `0x${"4".repeat(64)}`,
                simulation_mode: false,
                was_defaulted: false,
                auto_default_rating: false,
                holder: `0x${"6".repeat(64)}`,
                rated_by: "0x0",
                notarization_id: `0x${"5".repeat(64)}`,
                invoice_hash: new Array(32).fill(1),
              },
            },
          },
        }));
      },
      async queryTransactionBlocks(input: {
        filter: { MoveFunction: { function: string } };
      }) {
        if (input.filter.MoveFunction.function === "repay_invoice") {
          return {
            data: [
              {
                digest: repayDigest,
                objectChanges: [
                  {
                    type: "mutated",
                    objectId: invoiceId,
                    objectType: `${packageId}::invoice_vault::Invoice`,
                  },
                ],
              },
            ],
            hasNextPage: false,
            nextCursor: null,
          };
        }

        return {
          data: [],
          hasNextPage: false,
          nextCursor: null,
        };
      },
    } as unknown as IotaClient;

    const [record] = await fetchOnchainInvoices(client, "testnet", packageId);

    expect(record.repayDigest).toBe(repayDigest);
  });
});
