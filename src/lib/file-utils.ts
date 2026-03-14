export async function fileToBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function bytesToSha256Hex(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fileToSha256Hex(file: File) {
  return bytesToSha256Hex(await fileToBytes(file));
}

export const INVOICE_NOTARIZATION_STATE_METADATA =
  "application/vnd.invoicevault.pdf-hash+sha256;v=1";
export const INVOICE_NOTARIZATION_DESCRIPTION = "InvoiceVault PDF SHA-256 anchor";

export type InvoiceNotarizationMetadata = {
  schema: "invoicevault.notarization.metadata.v1";
  documentType: "invoice_pdf";
  mimeType?: string | null;
  sizeBytes: number;
};

export function buildInvoiceNotarizationMetadata(input: {
  mimeType?: string | null;
  sizeBytes: number;
}) {
  const metadata: InvoiceNotarizationMetadata = {
    schema: "invoicevault.notarization.metadata.v1",
    documentType: "invoice_pdf",
    mimeType: input.mimeType || "application/pdf",
    sizeBytes: input.sizeBytes,
  };

  return JSON.stringify(metadata);
}

export function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const pairs = clean.match(/.{1,2}/g) ?? [];

  return new Uint8Array(
    pairs.map((pair) => Number.parseInt(pair, 16)),
  );
}

export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
