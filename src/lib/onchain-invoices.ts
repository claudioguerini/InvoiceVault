import { IotaClient, type EventId, type IotaEvent } from "@iota/iota-sdk/client";
import { InvoiceRecord, isTerminalStatus } from "@/lib/invoice-store";
import {
  normalizeIotaAddressValue,
  normalizeIotaObjectIdValue,
} from "@/lib/iota-ids";
import { toNanoString } from "@/lib/iota-amount";

const MODULE_NAME = "invoice_vault";
const PAGE_LIMIT = 50;
const OBJECT_CHUNK_SIZE = 50;
const ZERO_ADDRESS = normalizeIotaAddressValue("0x0");

type CreateInvoiceFn = "create_invoice" | "create_invoice_simulation";
type AuditDigestFn =
  | CreateInvoiceFn
  | "list_for_funding"
  | "fund_invoice"
  | "cancel_invoice"
  | "repay_invoice"
  | "mark_defaulted"
  | "rate_invoice";
type AuditDigestField =
  | "createDigest"
  | "listDigest"
  | "fundDigest"
  | "cancelDigest"
  | "repayDigest"
  | "defaultDigest"
  | "rateDigest";

type InvoiceEventCacheEntry = {
  ids: string[];
  latestEventId: string | null;
};

type InvoiceTransactionCacheEntry = {
  ids: string[];
  latestDigests: Record<CreateInvoiceFn, string | null>;
};

type InvoiceAuditDigestCacheEntry = {
  byInvoiceId: Record<string, Partial<Record<AuditDigestField, string>>>;
  latestDigests: Record<AuditDigestFn, string | null>;
};

const invoiceIdsByEventCache = new Map<string, InvoiceEventCacheEntry>();
const invoiceIdsByTransactionCache = new Map<string, InvoiceTransactionCacheEntry>();
const invoiceAuditDigestCache = new Map<string, InvoiceAuditDigestCacheEntry>();
const registryIdCache = new Map<string, string | null>();

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

function asU64String(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return "0";
}

function asAddressOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeIotaAddressValue(value);
  if (!normalized || normalized === ZERO_ADDRESS) return null;
  return normalized;
}

function asObjectIdOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeIotaObjectIdValue(value);
  if (!normalized || normalized === ZERO_ADDRESS) return null;
  return normalized;
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
  network: string,
  packageId: string,
  registryId: string | null,
  objectId: string,
  content: MoveObjectContent,
): InvoiceRecord | null {
  const fields = content.fields;
  if (!fields) return null;

  const amountNanos = asU64String(fields.amount);
  const dueDateEpochSec = asNumber(fields.due_date);
  const discountRaw = asU64String(fields.discount_price);
  const ratingRaw = asNumber(fields.rating_score);
  const fundedAtMsRaw = asNumber(fields.funded_at_ms);
  const defaultedAtMsRaw = asNumber(fields.defaulted_at_ms);
  const recoveredAtMsRaw = asNumber(fields.recovered_at_ms);
  const status = parseStatus(fields.status);
  const issuer =
    normalizeIotaAddressValue(typeof fields.issuer === "string" ? fields.issuer : null) ?? "";
  const lifecycleMode = asBoolean(fields.simulation_mode)
    ? "DEFAULT_SIMULATION"
    : "NORMAL";
  const wasDefaulted = asBoolean(fields.was_defaulted);
  const autoDefaultRating = asBoolean(fields.auto_default_rating);

  if (!issuer || amountNanos === "0" || dueDateEpochSec <= 0) return null;

  return {
    id: normalizeIotaObjectIdValue(objectId) ?? objectId.trim().toLowerCase(),
    network,
    packageId: normalizeIotaObjectIdValue(packageId) ?? packageId,
    registryId: normalizeIotaObjectIdValue(registryId) ?? registryId,
    notarizationId: asObjectIdOrNull(fields.notarization_id),
    notarizationMethod: "Locked",
    invoiceHashHex: parseHashHex(fields.invoice_hash),
    amountNanos,
    dueDateEpochSec,
    issuer,
    holder: asAddressOrNull(fields.holder),
    discountPriceNanos: discountRaw !== "0" ? discountRaw : null,
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

function cacheKey(network: string, packageId: string) {
  return `${network.trim().toLowerCase()}:${normalizeIotaObjectIdValue(packageId) ?? packageId.trim().toLowerCase()}`;
}

function eventKey(id: EventId | null | undefined) {
  if (!id) return null;
  return `${id.txDigest}:${id.eventSeq}`;
}

async function multiGetObjectsInChunks(client: IotaClient, ids: string[]) {
  const uniqueIds = [
    ...new Set(ids.map((id) => normalizeIotaObjectIdValue(id) ?? id.trim().toLowerCase())),
  ];
  const responses = [];

  for (let index = 0; index < uniqueIds.length; index += OBJECT_CHUNK_SIZE) {
    const batch = uniqueIds.slice(index, index + OBJECT_CHUNK_SIZE);
    responses.push(
      ...(await client.multiGetObjects({
        ids: batch,
        options: { showContent: true, showOwner: true },
      })),
    );
  }

  return responses;
}

function parseInvoiceIdFromEvent(event: IotaEvent): string | null {
  const parsed = event.parsedJson;
  if (!parsed || typeof parsed !== "object") return null;
  const invoiceId = (parsed as Record<string, unknown>).invoice_id;
  return typeof invoiceId === "string"
    ? normalizeIotaObjectIdValue(invoiceId) ?? invoiceId.trim().toLowerCase()
    : null;
}

function parseRegistryIdFromEvent(event: IotaEvent): string | null {
  const parsed = event.parsedJson;
  if (!parsed || typeof parsed !== "object") return null;
  const registryId = (parsed as Record<string, unknown>).registry_id;
  return typeof registryId === "string"
    ? normalizeIotaObjectIdValue(registryId) ?? registryId.trim().toLowerCase()
    : null;
}

function isInvoiceObjectType(value: unknown) {
  return typeof value === "string" && value.includes("::invoice_vault::Invoice");
}

function extractInvoiceIdsFromObjectChanges(
  changes: Array<Record<string, unknown>> | null | undefined,
) {
  const ids = new Set<string>();

  for (const change of changes ?? []) {
    const objectId =
      typeof change.objectId === "string"
        ? normalizeIotaObjectIdValue(change.objectId) ?? change.objectId.trim().toLowerCase()
        : null;
    if (!objectId || !isInvoiceObjectType(change.objectType)) continue;
    ids.add(objectId);
  }

  return [...ids];
}

function digestFieldForFn(fn: AuditDigestFn): AuditDigestField {
  if (fn === "create_invoice" || fn === "create_invoice_simulation") return "createDigest";
  if (fn === "list_for_funding") return "listDigest";
  if (fn === "fund_invoice") return "fundDigest";
  if (fn === "cancel_invoice") return "cancelDigest";
  if (fn === "repay_invoice") return "repayDigest";
  if (fn === "mark_defaulted") return "defaultDigest";
  return "rateDigest";
}

async function fetchInvoiceIdsFromEvents(client: IotaClient, network: string, packageId: string) {
  const key = cacheKey(network, packageId);
  const cached = invoiceIdsByEventCache.get(key);
  const eventType = `${packageId}::${MODULE_NAME}::InvoiceCreated`;
  const nextIds = new Set<string>();
  let cursor: EventId | null | undefined = null;
  let hasNextPage = true;
  let latestEventId = cached?.latestEventId ?? null;
  let reachedKnownEvent = false;
  let isFirstPage = true;

  while (hasNextPage && !reachedKnownEvent) {
    const page = await client.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      limit: PAGE_LIMIT,
      order: "descending",
    });

    if (isFirstPage && page.data[0]) {
      latestEventId = eventKey(page.data[0].id);
    }
    isFirstPage = false;

    for (const event of page.data) {
      const currentEventKey = eventKey(event.id);
      if (cached?.latestEventId && currentEventKey === cached.latestEventId) {
        reachedKnownEvent = true;
        break;
      }

      const invoiceId = parseInvoiceIdFromEvent(event);
      if (invoiceId) {
        nextIds.add(invoiceId);
      }
    }

    cursor = page.nextCursor;
    hasNextPage = page.hasNextPage;
  }

  const ids = [
    ...nextIds,
    ...(cached?.ids ?? []).filter((id) => !nextIds.has(id)),
  ];

  invoiceIdsByEventCache.set(key, {
    ids,
    latestEventId,
  });

  return ids;
}

async function fetchRegistryIdFromEvents(client: IotaClient, network: string, packageId: string) {
  const key = cacheKey(network, packageId);
  if (registryIdCache.has(key)) {
    return registryIdCache.get(key) ?? null;
  }

  const eventType = `${packageId}::${MODULE_NAME}::RegistryCreated`;
  const page = await client.queryEvents({
    query: { MoveEventType: eventType },
    limit: 1,
    order: "descending",
  });
  const registryId = page.data[0] ? parseRegistryIdFromEvent(page.data[0]) : null;
  registryIdCache.set(key, registryId);
  return registryId;
}

async function fetchInvoiceIdsFromTransactions(
  client: IotaClient,
  network: string,
  packageId: string,
) {
  const createFns = ["create_invoice", "create_invoice_simulation"] as const;
  const key = cacheKey(network, packageId);
  const cached = invoiceIdsByTransactionCache.get(key);
  const createdIds = new Set<string>(cached?.ids ?? []);
  const latestDigests: Record<CreateInvoiceFn, string | null> = {
    create_invoice: cached?.latestDigests.create_invoice ?? null,
    create_invoice_simulation: cached?.latestDigests.create_invoice_simulation ?? null,
  };

  for (const createFn of createFns) {
    let cursor: string | null | undefined = null;
    let hasNextPage = true;
    let reachedKnownDigest = false;
    let isFirstPage = true;

    while (hasNextPage && !reachedKnownDigest) {
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
        limit: PAGE_LIMIT,
        order: "descending",
      });

      if (isFirstPage && page.data[0]) {
        latestDigests[createFn] = page.data[0].digest;
      }
      isFirstPage = false;

      for (const tx of page.data) {
        if (cached?.latestDigests[createFn] && tx.digest === cached.latestDigests[createFn]) {
          reachedKnownDigest = true;
          break;
        }

        for (const change of tx.objectChanges ?? []) {
          if (
            change.type === "created" &&
            "objectId" in change &&
            typeof change.objectId === "string" &&
            "objectType" in change &&
            typeof change.objectType === "string" &&
            change.objectType.includes("::invoice_vault::Invoice")
          ) {
            createdIds.add(
              normalizeIotaObjectIdValue(change.objectId) ?? change.objectId.trim().toLowerCase(),
            );
          }
        }
      }

      cursor = page.nextCursor;
      hasNextPage = page.hasNextPage;
    }
  }

  const ids = [...createdIds];
  invoiceIdsByTransactionCache.set(key, {
    ids,
    latestDigests,
  });

  return ids;
}

async function fetchInvoiceAuditDigests(
  client: IotaClient,
  network: string,
  packageId: string,
) {
  const auditFns: AuditDigestFn[] = [
    "create_invoice",
    "create_invoice_simulation",
    "list_for_funding",
    "fund_invoice",
    "cancel_invoice",
    "repay_invoice",
    "mark_defaulted",
    "rate_invoice",
  ];
  const key = cacheKey(network, packageId);
  const cached = invoiceAuditDigestCache.get(key);
  const byInvoiceId: Record<string, Partial<Record<AuditDigestField, string>>> = {
    ...(cached?.byInvoiceId ?? {}),
  };
  const latestDigests: Record<AuditDigestFn, string | null> = {
    create_invoice: cached?.latestDigests.create_invoice ?? null,
    create_invoice_simulation: cached?.latestDigests.create_invoice_simulation ?? null,
    list_for_funding: cached?.latestDigests.list_for_funding ?? null,
    fund_invoice: cached?.latestDigests.fund_invoice ?? null,
    cancel_invoice: cached?.latestDigests.cancel_invoice ?? null,
    repay_invoice: cached?.latestDigests.repay_invoice ?? null,
    mark_defaulted: cached?.latestDigests.mark_defaulted ?? null,
    rate_invoice: cached?.latestDigests.rate_invoice ?? null,
  };

  for (const fn of auditFns) {
    let cursor: string | null | undefined = null;
    let hasNextPage = true;
    let reachedKnownDigest = false;
    let isFirstPage = true;

    while (hasNextPage && !reachedKnownDigest) {
      const page = await client.queryTransactionBlocks({
        filter: {
          MoveFunction: {
            package: packageId,
            module: MODULE_NAME,
            function: fn,
          },
        },
        options: { showObjectChanges: true },
        cursor,
        limit: PAGE_LIMIT,
        order: "descending",
      });

      if (isFirstPage && page.data[0]) {
        latestDigests[fn] = page.data[0].digest;
      }
      isFirstPage = false;

      for (const tx of page.data) {
        if (cached?.latestDigests[fn] && tx.digest === cached.latestDigests[fn]) {
          reachedKnownDigest = true;
          break;
        }

        const invoiceIds = extractInvoiceIdsFromObjectChanges(
          (tx.objectChanges ?? []) as Array<Record<string, unknown>>,
        );
        if (invoiceIds.length === 0) continue;

        const digestField = digestFieldForFn(fn);
        for (const invoiceId of invoiceIds) {
          const existing = byInvoiceId[invoiceId] ?? {};
          if (!existing[digestField]) {
            byInvoiceId[invoiceId] = {
              ...existing,
              [digestField]: tx.digest,
            };
          }
        }
      }

      cursor = page.nextCursor;
      hasNextPage = page.hasNextPage;
    }
  }

  invoiceAuditDigestCache.set(key, {
    byInvoiceId,
    latestDigests,
  });

  return byInvoiceId;
}

export async function fetchRegistryId(client: IotaClient, network: string, packageId: string) {
  return fetchRegistryIdFromEvents(client, network, packageId);
}

export async function fetchOnchainInvoices(
  client: IotaClient,
  network: string,
  packageId: string,
): Promise<InvoiceRecord[]> {
  const normalizedPackageId = normalizeIotaObjectIdValue(packageId) ?? packageId;
  const registryId = await fetchRegistryIdFromEvents(client, network, packageId).catch(() => null);
  let createdIds = await fetchInvoiceIdsFromEvents(client, network, packageId).catch(() => []);

  if (createdIds.length === 0) {
    createdIds = await fetchInvoiceIdsFromTransactions(client, network, packageId).catch(() => []);
  }

  if (createdIds.length === 0) return [];

  const objects = await multiGetObjectsInChunks(client, createdIds);

  const records = objects
    .map((response) => {
      const data = response.data;
      if (!data?.objectId) return null;
      const owner = data.owner as ObjectOwner | undefined;
      const isShared = typeof owner === "object" && owner !== null && "Shared" in owner;
      if (!isShared) return null;
      const content = data.content as MoveObjectContent | undefined;
      if (!content || content.dataType !== "moveObject") return null;
      return parseInvoiceRecord(
        network,
        normalizedPackageId,
        registryId,
        data.objectId,
        content,
      );
    })
    .filter((item): item is InvoiceRecord => Boolean(item));

  const auditDigestsByInvoice = await fetchInvoiceAuditDigests(client, network, packageId).catch(
    () => ({} as Record<string, Partial<Record<AuditDigestField, string>>>),
  );

  return records
    .map((item) => ({
      ...item,
      ...(auditDigestsByInvoice[item.id] ?? {}),
    }))
    .sort((a, b) => b.dueDateEpochSec - a.dueDateEpochSec);
}

function shouldPreferLocalOptimisticState(chainItem: InvoiceRecord, localItem: InvoiceRecord) {
  if (isTerminalStatus(localItem.status) && !isTerminalStatus(chainItem.status)) {
    return true;
  }

  if (
    localItem.status === "FUNDED" &&
    chainItem.status === "OPEN" &&
    localItem.fundDigest &&
    typeof localItem.fundedAtMs === "number" &&
    Date.now() - localItem.fundedAtMs <= 120_000
  ) {
    return true;
  }

  if (
    localItem.status === "REPAID" &&
    (chainItem.status === "OPEN" || chainItem.status === "FUNDED") &&
    localItem.repayDigest
  ) {
    return true;
  }

  if (localItem.status === "DEFAULTED" && chainItem.status === "FUNDED" && localItem.defaultDigest) {
    return true;
  }

  if (
    localItem.status === "RECOVERED" &&
    chainItem.status !== "RECOVERED" &&
    localItem.repayDigest
  ) {
    return true;
  }

  if (localItem.status === "CANCELLED" && chainItem.status === "OPEN" && localItem.cancelDigest) {
    return true;
  }

  return false;
}

export function mergeScopedInvoices(local: InvoiceRecord[], chain: InvoiceRecord[]) {
  const byId = new Map<string, InvoiceRecord>();
  chain.forEach((item) => byId.set(item.id, item));

  local.forEach((item) => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      return;
    }

    byId.set(item.id, {
      ...item,
      ...existing,
      amountNanos: toNanoString(existing.amountNanos || item.amountNanos),
      discountPriceNanos:
        existing.discountPriceNanos ?? item.discountPriceNanos ?? null,
      notarizationId: existing.notarizationId ?? item.notarizationId ?? null,
      notarizationMethod:
        existing.notarizationMethod ?? item.notarizationMethod ?? null,
      notarizationPackageId:
        existing.notarizationPackageId ?? item.notarizationPackageId ?? null,
      notarizationCreatedAtMs:
        existing.notarizationCreatedAtMs ?? item.notarizationCreatedAtMs ?? null,
      createDigest: existing.createDigest ?? item.createDigest,
      notarizationDigest: existing.notarizationDigest ?? item.notarizationDigest,
      listDigest: existing.listDigest ?? item.listDigest,
      fundDigest: existing.fundDigest ?? item.fundDigest,
      cancelDigest: existing.cancelDigest ?? item.cancelDigest,
      repayDigest: existing.repayDigest ?? item.repayDigest,
      defaultDigest: existing.defaultDigest ?? item.defaultDigest,
      rateDigest: existing.rateDigest ?? item.rateDigest,
    });

    const merged = byId.get(item.id);
    if (!merged) return;

    if (shouldPreferLocalOptimisticState(existing, item)) {
      merged.status = item.status;
      merged.holder = item.holder ?? existing.holder ?? null;
      merged.discountPriceNanos = item.discountPriceNanos ?? existing.discountPriceNanos ?? null;
      merged.ratingScore = item.ratingScore ?? existing.ratingScore ?? null;
      merged.ratedBy = item.ratedBy ?? existing.ratedBy ?? null;
      merged.autoDefaultRating = item.autoDefaultRating ?? existing.autoDefaultRating;
      merged.wasDefaulted = item.wasDefaulted ?? existing.wasDefaulted ?? false;
      merged.fundedAtMs = item.fundedAtMs ?? existing.fundedAtMs ?? null;
      merged.defaultedAtMs = item.defaultedAtMs ?? existing.defaultedAtMs ?? null;
      merged.recoveredAtMs = item.recoveredAtMs ?? existing.recoveredAtMs ?? null;
    }

    if (!existing.discountPriceNanos && item.discountPriceNanos) {
      merged.discountPriceNanos = item.discountPriceNanos;
    }

    if (!existing.ratingScore && item.ratingScore) {
      merged.ratingScore = item.ratingScore;
      merged.ratedBy = item.ratedBy ?? merged.ratedBy ?? null;
      merged.autoDefaultRating = item.autoDefaultRating ?? merged.autoDefaultRating;
    }
  });

  return [...byId.values()].sort((a, b) => b.dueDateEpochSec - a.dueDateEpochSec);
}
