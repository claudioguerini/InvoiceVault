"use client";

import { normalizeIotaObjectIdValue } from "@/lib/iota-ids";

const PACKAGE_OVERRIDE_STORAGE_KEY = "invoice-vault-package-override-v2";
export const PACKAGE_OVERRIDE_EVENT = "invoicevault:package-override-changed";

export type PackageOverrides = {
  invoicePackageId: string | null;
  notarizationPackageId: string | null;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function overrideStorageKey(network: string) {
  return `${PACKAGE_OVERRIDE_STORAGE_KEY}:${network.trim().toLowerCase()}`;
}

function emptyPackageOverrides(): PackageOverrides {
  return {
    invoicePackageId: null,
    notarizationPackageId: null,
  };
}

function normalizePackageOverrides(value: unknown): PackageOverrides {
  if (typeof value === "string") {
    return {
      invoicePackageId: normalizeIotaObjectIdValue(value),
      notarizationPackageId: null,
    };
  }

  if (!value || typeof value !== "object") {
    return emptyPackageOverrides();
  }

  const candidate = value as Partial<PackageOverrides> & {
    packageId?: string | null;
  };

  return {
    invoicePackageId: normalizeIotaObjectIdValue(
      candidate.invoicePackageId ?? candidate.packageId,
    ),
    notarizationPackageId: normalizeIotaObjectIdValue(candidate.notarizationPackageId),
  };
}

export function loadPackageOverrides(network: string): PackageOverrides {
  if (!isBrowser()) return emptyPackageOverrides();

  const raw = window.localStorage.getItem(overrideStorageKey(network));
  if (!raw) return emptyPackageOverrides();

  try {
    return normalizePackageOverrides(JSON.parse(raw));
  } catch {
    return normalizePackageOverrides(raw);
  }
}

function emitPackageOverrideEvent(network: string, overrides: PackageOverrides) {
  window.dispatchEvent(
    new CustomEvent(PACKAGE_OVERRIDE_EVENT, {
      detail: {
        network,
        ...overrides,
      },
    }),
  );
}

export function savePackageOverrides(network: string, overrides: PackageOverrides) {
  if (!isBrowser()) return;

  const normalized = normalizePackageOverrides(overrides);
  const key = overrideStorageKey(network);

  if (normalized.invoicePackageId || normalized.notarizationPackageId) {
    window.localStorage.setItem(key, JSON.stringify(normalized));
  } else {
    window.localStorage.removeItem(key);
  }

  emitPackageOverrideEvent(network, normalized);
}

export function loadPackageOverride(network: string) {
  return loadPackageOverrides(network).invoicePackageId;
}

export function loadNotarizationPackageOverride(network: string) {
  return loadPackageOverrides(network).notarizationPackageId;
}

export function savePackageOverride(
  network: string,
  invoicePackageId: string | null | undefined,
  notarizationPackageId?: string | null | undefined,
) {
  savePackageOverrides(network, {
    invoicePackageId: normalizeIotaObjectIdValue(invoicePackageId),
    notarizationPackageId: normalizeIotaObjectIdValue(notarizationPackageId),
  });
}

export function clearPackageOverride(network: string) {
  savePackageOverrides(network, emptyPackageOverrides());
}
