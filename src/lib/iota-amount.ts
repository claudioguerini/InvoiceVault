export const NANOS_PER_IOTA = 1_000_000_000n;

function normalizeNanos(value: bigint | string | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  return trimmed ? BigInt(trimmed) : 0n;
}

export function parseIotaInput(value: string): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  if (!/^\d+(\.\d{0,9})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const normalizedWhole = wholePart.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fractionPart.replace(/0+$/, "");

  return normalizedFraction
    ? `${normalizedWhole}.${normalizedFraction}`
    : normalizedWhole;
}

export function iotaToNanos(amountIota: string): bigint {
  const normalized = parseIotaInput(amountIota);
  if (!normalized) return 0n;

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionPart.padEnd(9, "0") || "0").slice(0, 9));
  return whole * NANOS_PER_IOTA + fraction;
}

export function nanosToIota(amountNanos: bigint | string | number): string {
  const nanos = normalizeNanos(amountNanos);
  const whole = nanos / NANOS_PER_IOTA;
  const fraction = nanos % NANOS_PER_IOTA;
  const fractionText = fraction
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");

  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

export function formatIota(
  amountNanos: bigint | string | number,
  locale = "en-US",
  maximumFractionDigits = 6,
) {
  const nanos = normalizeNanos(amountNanos);
  const whole = nanos / NANOS_PER_IOTA;
  const fraction = nanos % NANOS_PER_IOTA;
  const fractionText = fraction
    .toString()
    .padStart(9, "0")
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");

  const formattedWhole = whole.toLocaleString(locale);
  return fractionText ? `${formattedWhole}.${fractionText}` : formattedWhole;
}

export function nanosToIotaInput(amountNanos: bigint | string | number) {
  return nanosToIota(amountNanos);
}

export function isPositiveNanoAmount(value: bigint | string | number | null | undefined) {
  if (value === null || value === undefined) return false;
  return normalizeNanos(value) > 0n;
}

export function compareNanos(
  left: bigint | string | number | null | undefined,
  right: bigint | string | number | null | undefined,
) {
  const leftValue = left === null || left === undefined ? 0n : normalizeNanos(left);
  const rightValue = right === null || right === undefined ? 0n : normalizeNanos(right);

  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

export function computeYieldPct(
  amountNanos: bigint | string | number,
  discountPriceNanos: bigint | string | number | null | undefined,
) {
  if (discountPriceNanos === null || discountPriceNanos === undefined) return null;

  const amount = normalizeNanos(amountNanos);
  const discount = normalizeNanos(discountPriceNanos);
  if (discount <= 0n) return null;

  const scaledPct = ((amount - discount) * 10_000n) / discount;
  return Number(scaledPct) / 100;
}

export function toNanoString(value: bigint | string | number) {
  return normalizeNanos(value).toString();
}

export function nanoStringToBigInt(value: bigint | string | number | null | undefined) {
  if (value === null || value === undefined) return 0n;
  return normalizeNanos(value);
}
