import { bcs } from "@iota/iota-sdk/bcs";
import type { IotaClient, IotaTransactionBlockResponse } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";

type NotarizationModule = typeof import("@iota/notarization/web");

let notarizationModulePromise: Promise<NotarizationModule> | null = null;
const NOTARIZATION_WASM_URL = "/vendor/iota/notarization_wasm_bg.wasm";

async function loadNotarizationModule() {
  if (!notarizationModulePromise) {
    notarizationModulePromise = (async () => {
      try {
        const notarizationLib = await import("@iota/notarization/web");
        await notarizationLib.init(NOTARIZATION_WASM_URL);
        return notarizationLib;
      } catch (error) {
        notarizationModulePromise = null;
        if (error instanceof Error) {
          throw new Error(
            `Unable to initialize IOTA notarization runtime from ${NOTARIZATION_WASM_URL}: ${error.message}`,
          );
        }
        throw error;
      }
    })();
  }

  return notarizationModulePromise;
}

function transactionFromNotarizationBytes(programmableBytes: Uint8Array) {
  try {
    return Transaction.fromKind(programmableBytes);
  } catch (kindError) {
    try {
      // The notarization WASM currently returns raw ProgrammableTransaction bytes.
      const programmableTransaction = bcs.ProgrammableTransaction.parse(programmableBytes);
      const wrappedKindBytes = bcs.TransactionKind.serialize({
        ProgrammableTransaction: programmableTransaction,
      }).toBytes();
      return Transaction.fromKind(wrappedKindBytes);
    } catch {
      throw kindError;
    }
  }
}

function toMaybeMs(epochValue: bigint) {
  const numeric = Number(epochValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export type LockedNotarizationTx = {
  transaction: Transaction;
  notarizationPackageId: string;
  extractNotarization(
    settled: Pick<IotaTransactionBlockResponse, "effects" | "events" | "objectChanges">,
  ): Promise<{
    id: string;
    method: "Locked" | "Dynamic";
    createdAtMs: number | null;
    packageId: string;
  } | null>;
};

export async function buildLockedNotarizationTx(input: {
  iotaClient: IotaClient;
  notarizationPackageId?: string | null;
  stateBytes: Uint8Array;
  stateMetadata?: string | null;
  immutableDescription?: string | null;
  updatableMetadata?: string | null;
}) {
  const notarizationLib = await loadNotarizationModule();
  const readOnly = input.notarizationPackageId
    ? await notarizationLib.NotarizationClientReadOnly.createWithPkgId(
        input.iotaClient,
        input.notarizationPackageId,
      )
    : await notarizationLib.NotarizationClientReadOnly.create(input.iotaClient);

  let builder = notarizationLib.NotarizationBuilderLocked.locked().withBytesState(
    input.stateBytes,
    input.stateMetadata ?? null,
  );

  if (input.immutableDescription) {
    builder = builder.withImmutableDescription(input.immutableDescription);
  }

  if (input.updatableMetadata !== undefined) {
    builder = builder.withUpdatableMetadata(input.updatableMetadata ?? null);
  }

  const txBuilder = builder.finish();
  const programmableBytes =
    await txBuilder.transaction.buildProgrammableTransaction(readOnly as never);

  return {
    transaction: transactionFromNotarizationBytes(programmableBytes),
    notarizationPackageId: readOnly.packageId(),
    async extractNotarization(settled) {
      if (!settled.effects || !settled.events) {
        return null;
      }

      try {
        const notarization = await txBuilder.transaction.applyWithEvents(
          settled.effects as never,
          settled.events,
          readOnly as never,
        );

        return {
          id: notarization.id,
          method: notarization.method,
          createdAtMs: toMaybeMs(notarization.immutableMetadata.createdAt),
          packageId: readOnly.packageId(),
        };
      } catch {
        const createdObject = settled.objectChanges?.find(
          (change) =>
            change.type === "created" &&
            "objectId" in change &&
            typeof change.objectId === "string" &&
            "objectType" in change &&
            typeof change.objectType === "string" &&
            change.objectType.toLowerCase().includes("notarization"),
        );

        if (!createdObject || !("objectId" in createdObject)) {
          return null;
        }

        try {
          const notarization = await readOnly.getNotarizationById(createdObject.objectId);
          return {
            id: notarization.id,
            method: notarization.method,
            createdAtMs: toMaybeMs(notarization.immutableMetadata.createdAt),
            packageId: readOnly.packageId(),
          };
        } catch {
          return null;
        }
      }
    },
  } satisfies LockedNotarizationTx;
}

export async function fetchNotarizationById(input: {
  iotaClient: IotaClient;
  notarizationId: string;
  notarizationPackageId?: string | null;
}) {
  const notarizationLib = await loadNotarizationModule();
  const readOnly = input.notarizationPackageId
    ? await notarizationLib.NotarizationClientReadOnly.createWithPkgId(
        input.iotaClient,
        input.notarizationPackageId,
      )
    : await notarizationLib.NotarizationClientReadOnly.create(input.iotaClient);

  const notarization = await readOnly.getNotarizationById(input.notarizationId);
  const stateBytes = notarization.state.data.toBytes();

  return {
    id: notarization.id,
    method: notarization.method,
    owner: notarization.owner,
    packageId: readOnly.packageId(),
    createdAtMs: toMaybeMs(notarization.immutableMetadata.createdAt),
    lastStateChangeAtMs: toMaybeMs(notarization.lastStateChangeAt),
    description: notarization.immutableMetadata.description ?? null,
    updatableMetadata: notarization.updatableMetadata ?? null,
    stateMetadata: notarization.state.metadata ?? null,
    stateBytes,
    irl: notarization.iotaResourceLocatorBuilder(readOnly.network()).data(),
  };
}
