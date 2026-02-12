const NANOS_PER_IOTA = 1_000_000_000;

export function parseIotaInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  return parsed;
}

export function iotaToNanos(amountIota: number): number {
  return Math.round(amountIota * NANOS_PER_IOTA);
}

export function nanosToIota(amountNanos: number): number {
  return amountNanos / NANOS_PER_IOTA;
}

export function formatIota(amountNanos: number): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(nanosToIota(amountNanos));
}

export { NANOS_PER_IOTA };
