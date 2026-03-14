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
import { useEffect, useMemo, useState } from "react";
import type { StorageScope } from "@/lib/invoice-store";
import {
  loadPackageOverrides,
  type PackageOverrides,
  PACKAGE_OVERRIDE_EVENT,
} from "@/lib/app-session";
import { normalizeIotaObjectIdValue } from "@/lib/iota-ids";

const { networkConfig, useNetworkVariable } = createNetworkConfig({
  devnet: {
    url: getFullnodeUrl("devnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_DEVNET ?? "",
      notarizationPackageId: process.env.NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_DEVNET ?? "",
    },
  },
  testnet: {
    url: getFullnodeUrl("testnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_TESTNET ?? "",
      notarizationPackageId: process.env.NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_TESTNET ?? "",
    },
  },
  mainnet: {
    url: getFullnodeUrl("mainnet"),
    variables: {
      invoicePackageId: process.env.NEXT_PUBLIC_IOTA_PACKAGE_ID_MAINNET ?? "",
      notarizationPackageId: process.env.NEXT_PUBLIC_IOTA_NOTARIZATION_PACKAGE_ID_MAINNET ?? "",
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

function usePackageOverridesState(network: string) {
  const [packageOverrides, setPackageOverrides] = useState<PackageOverrides>(() =>
    loadPackageOverrides(network),
  );

  useEffect(() => {
    const syncOverride = () => setPackageOverrides(loadPackageOverrides(network));

    syncOverride();
    window.addEventListener("storage", syncOverride);
    window.addEventListener(PACKAGE_OVERRIDE_EVENT, syncOverride);

    return () => {
      window.removeEventListener("storage", syncOverride);
      window.removeEventListener(PACKAGE_OVERRIDE_EVENT, syncOverride);
    };
  }, [network]);

  return packageOverrides;
}

export function useEffectivePackages() {
  const { network } = useIotaClientContext();
  const envPackageId = normalizeIotaObjectIdValue(useNetworkVariable("invoicePackageId")) ?? "";
  const envNotarizationPackageId =
    normalizeIotaObjectIdValue(useNetworkVariable("notarizationPackageId")) ?? "";
  const packageOverrides = usePackageOverridesState(network);
  const packageId = packageOverrides.invoicePackageId ?? envPackageId;
  const notarizationPackageId =
    packageOverrides.notarizationPackageId ?? envNotarizationPackageId;

  return {
    network,
    packageId,
    envPackageId,
    notarizationPackageId,
    envNotarizationPackageId,
    packageOverride: packageOverrides.invoicePackageId,
    notarizationPackageOverride: packageOverrides.notarizationPackageId,
    hasPackageOverride: Boolean(packageOverrides.invoicePackageId),
    hasNotarizationPackageOverride: Boolean(packageOverrides.notarizationPackageId),
  };
}

export function useEffectivePackageId() {
  const {
    network,
    packageId,
    envPackageId,
    packageOverride,
    hasPackageOverride,
  } = useEffectivePackages();

  return {
    network,
    packageId,
    envPackageId,
    packageOverride,
    hasPackageOverride,
  };
}

export function useEffectiveNotarizationPackageId() {
  const {
    network,
    notarizationPackageId,
    envNotarizationPackageId,
    notarizationPackageOverride,
    hasNotarizationPackageOverride,
  } = useEffectivePackages();

  return {
    network,
    notarizationPackageId,
    envPackageId: envNotarizationPackageId,
    packageOverride: notarizationPackageOverride,
    hasPackageOverride: hasNotarizationPackageOverride,
  };
}

export function useActiveStorageScope(): StorageScope {
  const { network, packageId } = useEffectivePackageId();

  return useMemo(
    () => ({
      network,
      packageId: packageId || null,
    }),
    [network, packageId],
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <IotaClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </IotaClientProvider>
    </QueryClientProvider>
  );
}
