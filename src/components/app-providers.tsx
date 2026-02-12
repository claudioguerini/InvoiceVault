"use client";

import "@iota/dapp-kit/dist/index.css";
import {
  IotaClientProvider,
  WalletProvider,
  createNetworkConfig,
  useIotaClientContext,
} from "@iota/dapp-kit";
import { getFullnodeUrl } from "@iota/iota-sdk/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const { networkConfig, useNetworkVariable } = createNetworkConfig({
  devnet: {
    url: getFullnodeUrl("devnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET ?? "",
    },
  },
  testnet: {
    url: getFullnodeUrl("testnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET ?? "",
    },
  },
  mainnet: {
    url: getFullnodeUrl("mainnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET ?? "",
    },
  },
});

export { useNetworkVariable };

export function useNetworkState() {
  const { network, networks, selectNetwork } = useIotaClientContext();

  return {
    network,
    networks: Object.keys(networks),
    selectNetwork,
  };
}

export function useEffectivePackageId() {
  const { network } = useIotaClientContext();
  const envPackageId = useNetworkVariable("invoicePackageId") ?? "";
  const packageId = envPackageId;

  return {
    network,
    packageId,
    envPackageId,
  };
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <IotaClientProvider networks={networkConfig} defaultNetwork="devnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </IotaClientProvider>
    </QueryClientProvider>
  );
}
