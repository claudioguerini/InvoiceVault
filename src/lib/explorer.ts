const EXPLORER_BASE_URL = "https://explorer.iota.org";

function normalizeExplorerNetwork(network: string) {
  const normalized = network.trim().toLowerCase();

  if (normalized === "mainnet" || normalized === "testnet" || normalized === "devnet") {
    return normalized;
  }

  return "devnet";
}

function buildExplorerUrl(pathname: string, network: string) {
  return `${EXPLORER_BASE_URL}${pathname}?network=${normalizeExplorerNetwork(network)}`;
}

export function buildObjectExplorerUrl(objectId: string, network: string) {
  return buildExplorerUrl(`/object/${objectId}`, network);
}

export function buildTxExplorerUrl(digest: string, network: string) {
  return buildExplorerUrl(`/txblock/${digest}`, network);
}
