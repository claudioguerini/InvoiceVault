import { IotaClient } from "@iota/iota-sdk/client";
import { InvoiceRecord } from "@/lib/invoice-store";

const MODULE_NAME = "invoice_vault";
const CREATE_FNS = ["create_invoice", "create_invoice_simulation"] as const;

type MoveObjectContent = {
  dataType?: string;
  type?: string;
  fields?: Record<string, unknown>;
};

type ObjectOwner =
  | "Immutable"
  | { AddressOwner: string }
  | { ObjectOwner: string }
  | { Shared: { initial_shared_version: string } };

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asAddressOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "0x0") return null;
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return false;
}

function parseHashHex(value: unknown): string {
  if (!Array.isArray(value)) return "";
  if (!value.every((item) => typeof item === "number")) return "";
  return value
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function parseStatus(value: unknown): InvoiceRecord["status"] {
  const raw = asNumber(value);
  if (raw === 1) return "FUNDED";
  if (raw === 2) return "REPAID";
  if (raw === 3) return "CANCELLED";
  if (raw === 4) return "DEFAULTED";
  if (raw === 5) return "RECOVERED";
  return "OPEN";
}

function parseInvoiceRecord(
  packageId: string,
  objectId: string,
  content: MoveObjectContent,
): InvoiceRecord | null {
  const fields = content.fields;
  if (!fields) return null;

  const amount = asNumber(fields.amount);
  const dueDateEpochSec = asNumber(fields.due_date);
  const discountRaw = asNumber(fields.discount_price);
  const ratingRaw = asNumber(fields.rating_score);
  const fundedAtMsRaw = asNumber(fields.funded_at_ms);
  const defaultedAtMsRaw = asNumber(fields.defaulted_at_ms);
  const recoveredAtMsRaw = asNumber(fields.recovered_at_ms);
  const status = parseStatus(fields.status);
  const issuer = typeof fields.issuer === "string" ? fields.issuer : "";
  const lifecycleMode = asBoolean(fields.simulation_mode)
    ? "DEFAULT_SIMULATION"
    : "NORMAL";
  const wasDefaulted = asBoolean(fields.was_defaulted);
  const autoDefaultRating = asBoolean(fields.auto_default_rating);

  if (!issuer || amount <= 0 || dueDateEpochSec <= 0) return null;

  return {
    id: objectId,
    packageId,
    invoiceHashHex: parseHashHex(fields.invoice_hash),
    amount,
    dueDateEpochSec,
    issuer,
    holder: asAddressOrNull(fields.holder),
    discountPrice: discountRaw > 0 ? discountRaw : null,
    ratingScore: ratingRaw > 0 ? ratingRaw : null,
    ratedBy: asAddressOrNull(fields.rated_by),
    status,
    lifecycleMode,
    wasDefaulted,
    fundedAtMs: fundedAtMsRaw > 0 ? fundedAtMsRaw : null,
    defaultedAtMs: defaultedAtMsRaw > 0 ? defaultedAtMsRaw : null,
    recoveredAtMs: recoveredAtMsRaw > 0 ? recoveredAtMsRaw : null,
    autoDefaultRating,
  };
}

export async function fetchOnchainInvoices(
  client: IotaClient,
  packageId: string,
): Promise<InvoiceRecord[]> {
  const createdIds = new Set<string>();
  for (const createFn of CREATE_FNS) {
    let cursor: string | null | undefined = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const page = await client.queryTransactionBlocks({
        filter: {
          MoveFunction: {
            package: packageId,
            module: MODULE_NAME,
            function: createFn,
          },
        },
        options: { showObjectChanges: true },
        cursor,
        limit: 50,
        order: "descending",
      });

      for (const tx of page.data) {
        for (const change of tx.objectChanges ?? []) {
          if (
            change.type === "created" &&
            "objectId" in change &&
            typeof change.objectId === "string" &&
            "objectType" in change &&
            typeof change.objectType === "string" &&
            change.objectType.includes("::invoice_vault::Invoice")
          ) {
            createdIds.add(change.objectId);
          }
        }
      }

      cursor = page.nextCursor;
      hasNextPage = page.hasNextPage;
    }
  }

  if (createdIds.size === 0) return [];

  const objects = await client.multiGetObjects({
    ids: [...createdIds],
    options: { showContent: true, showOwner: true },
  });

  const records = objects
    .map((response) => {
      const data = response.data;
      if (!data?.objectId) return null;
      const owner = data.owner as ObjectOwner | undefined;
      const isShared = typeof owner === "object" && owner !== null && "Shared" in owner;
      if (!isShared) return null;
      const content = data.content as MoveObjectContent | undefined;
      if (!content || content.dataType !== "moveObject") return null;
      return parseInvoiceRecord(packageId, data.objectId, content);
    })
    .filter((item): item is InvoiceRecord => Boolean(item));

  return records.sort((a, b) => b.dueDateEpochSec - a.dueDateEpochSec);
}
