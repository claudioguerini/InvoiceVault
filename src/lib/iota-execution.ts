import type {
  IotaClient,
  IotaTransactionBlockResponse,
  IotaTransactionBlockResponseOptions,
} from "@iota/iota-sdk/client";

export async function waitForSuccessfulTransaction(input: {
  iotaClient: IotaClient;
  digest: string;
  actionLabel: string;
  options?: IotaTransactionBlockResponseOptions;
}) {
  const settled = await input.iotaClient.waitForTransaction({
    digest: input.digest,
    options: {
      showEffects: true,
      ...input.options,
    },
  });

  const execution = settled.effects?.status;
  if (execution?.status === "failure") {
    throw new Error(
      execution.error
        ? `${input.actionLabel} failed on-chain: ${execution.error}`
        : `${input.actionLabel} failed on-chain.`,
    );
  }

  return settled;
}

export function didTransactionSucceed(
  settled: Pick<IotaTransactionBlockResponse, "effects">,
) {
  return settled.effects?.status?.status !== "failure";
}
