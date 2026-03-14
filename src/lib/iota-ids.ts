import { normalizeIotaAddress, normalizeIotaObjectId } from "@iota/iota-sdk/utils";

function normalizeHexValue(
  value: string | null | undefined,
  normalizer: (input: string) => string,
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  try {
    return normalizer(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
}

export function normalizeIotaAddressValue(value: string | null | undefined) {
  return normalizeHexValue(value, normalizeIotaAddress);
}

export function normalizeIotaObjectIdValue(value: string | null | undefined) {
  return normalizeHexValue(value, normalizeIotaObjectId);
}

export function sameIotaAddress(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const normalizedLeft = normalizeIotaAddressValue(left);
  const normalizedRight = normalizeIotaAddressValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
