"use client";

import { useIotaClient } from "@iota/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  useActiveStorageScope,
  useEffectivePackageId,
} from "@/components/app-providers";
import {
  INVOICE_STORE_EVENT,
  type InvoiceRecord,
  hideInvoiceIds,
  isPortfolioHideAllPending,
  loadHiddenInvoiceIds,
  loadInvoices,
  setPortfolioHideAllPending,
  type StorageScope,
} from "@/lib/invoice-store";
import { normalizeIotaObjectIdValue } from "@/lib/iota-ids";
import { fetchOnchainInvoices, mergeScopedInvoices } from "@/lib/onchain-invoices";

export type ScopedInvoicesSnapshot = {
  scope: StorageScope;
  hiddenIds: string[];
  localRecords: InvoiceRecord[];
  onchainRecords: InvoiceRecord[];
  mergedRecords: InvoiceRecord[];
  records: InvoiceRecord[];
};

const EMPTY_RECORDS: InvoiceRecord[] = [];
const EMPTY_IDS: string[] = [];

export function scopedInvoicesQueryKey(network: string, packageId: string | null | undefined) {
  return ["scoped-invoices", network, normalizeIotaObjectIdValue(packageId) ?? "local"] as const;
}

export async function fetchScopedInvoicesSnapshot(input: {
  iotaClient: ReturnType<typeof useIotaClient>;
  network: string;
  packageId: string;
  scope: StorageScope;
}): Promise<ScopedInvoicesSnapshot> {
  const { iotaClient, network, packageId, scope } = input;
  const hiddenIds = loadHiddenInvoiceIds(scope);
  const localRecords = loadInvoices(scope);
  const onchainRecords = packageId
    ? await fetchOnchainInvoices(iotaClient, network, packageId).catch(() => [])
    : [];
  const mergedRecords = mergeScopedInvoices(localRecords, onchainRecords);

  if (isPortfolioHideAllPending(scope)) {
    const nextHiddenIds = [...new Set([...hiddenIds, ...mergedRecords.map((item) => item.id)])];
    hideInvoiceIds(scope, mergedRecords.map((item) => item.id));
    setPortfolioHideAllPending(scope, false);

    return {
      scope,
      hiddenIds: nextHiddenIds,
      localRecords,
      onchainRecords,
      mergedRecords,
      records: [],
    };
  }

  const hiddenIdSet = new Set(hiddenIds);

  return {
    scope,
    hiddenIds,
    localRecords,
    onchainRecords,
    mergedRecords,
    records: mergedRecords.filter((item) => !hiddenIdSet.has(item.id)),
  };
}

type UseScopedInvoicesOptions = {
  enabled?: boolean;
};

export function useScopedInvoices(options?: UseScopedInvoicesOptions) {
  const iotaClient = useIotaClient();
  const queryClient = useQueryClient();
  const storageScope = useActiveStorageScope();
  const { network, packageId } = useEffectivePackageId();

  const queryKey = useMemo(
    () => scopedInvoicesQueryKey(network, packageId),
    [network, packageId],
  );

  useEffect(() => {
    function invalidate() {
      void queryClient.invalidateQueries({ queryKey });
    }

    function onStorage(event: StorageEvent) {
      if (!event.key || event.key.startsWith("invoice-vault-")) {
        invalidate();
      }
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(INVOICE_STORE_EVENT, invalidate);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(INVOICE_STORE_EVENT, invalidate);
    };
  }, [queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchScopedInvoicesSnapshot({
        iotaClient,
        network,
        packageId,
        scope: storageScope,
      }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? true,
  });

  return {
    ...query,
    scope: storageScope,
    records: query.data?.records ?? EMPTY_RECORDS,
    mergedRecords: query.data?.mergedRecords ?? EMPTY_RECORDS,
    hiddenIds: query.data?.hiddenIds ?? EMPTY_IDS,
    localRecords: query.data?.localRecords ?? EMPTY_RECORDS,
    onchainRecords: query.data?.onchainRecords ?? EMPTY_RECORDS,
  };
}
