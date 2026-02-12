import { Transaction } from "@iota/iota-sdk/transactions";

const MODULE_NAME = "invoice_vault";
const CLOCK_OBJECT_ID = "0x6";

function moveTarget(packageId: string, fn: string) {
  return `${packageId}::${MODULE_NAME}::${fn}`;
}

export function buildCreateInvoiceTx(
  packageId: string,
  invoiceHashHex: string,
  amount: number,
  dueDateEpochSec: number,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "create_invoice"),
    arguments: [
      tx.pure.vector("u8", hexToBytes(invoiceHashHex)),
      tx.pure.u64(amount),
      tx.pure.u64(dueDateEpochSec),
    ],
  });
  return tx;
}

export function buildCreateInvoiceSimulationTx(
  packageId: string,
  invoiceHashHex: string,
  amount: number,
  dueDateEpochSec: number,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "create_invoice_simulation"),
    arguments: [
      tx.pure.vector("u8", hexToBytes(invoiceHashHex)),
      tx.pure.u64(amount),
      tx.pure.u64(dueDateEpochSec),
    ],
  });
  return tx;
}

export function buildListForFundingTx(
  packageId: string,
  invoiceId: string,
  discountPrice: number,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "list_for_funding"),
    arguments: [tx.object(invoiceId), tx.pure.u64(discountPrice)],
  });
  return tx;
}

export function buildFundTx(
  packageId: string,
  invoiceId: string,
  discountPrice: number,
) {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(discountPrice)]);
  tx.moveCall({
    target: moveTarget(packageId, "fund_invoice"),
    arguments: [tx.object(invoiceId), payment, tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildRepayTx(packageId: string, invoiceId: string, amount: number) {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: moveTarget(packageId, "repay_invoice"),
    arguments: [tx.object(invoiceId), payment, tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildMarkDefaultedTx(packageId: string, invoiceId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "mark_defaulted"),
    arguments: [tx.object(invoiceId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildCancelTx(packageId: string, invoiceId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "cancel_invoice"),
    arguments: [tx.object(invoiceId)],
  });
  return tx;
}

export function buildRateInvoiceTx(
  packageId: string,
  invoiceId: string,
  score: number,
) {
  const tx = new Transaction();
  tx.moveCall({
    target: moveTarget(packageId, "rate_invoice"),
    arguments: [tx.object(invoiceId), tx.pure.u8(score)],
  });
  return tx;
}

function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const pairs = clean.match(/.{1,2}/g) ?? [];
  return pairs.map((pair) => Number.parseInt(pair, 16));
}
