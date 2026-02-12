"use client";

import { useNetworkState } from "@/components/app-providers";

export function NetworkControls() {
  const { network, networks, selectNetwork } = useNetworkState();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        className="h-10 min-w-[142px] rounded-xl border border-white/15 bg-slate-950/72 px-3 text-[1.02rem] font-semibold text-slate-100 outline-none transition focus:border-cyan-300/50"
        value={network}
        onChange={(event) => selectNetwork(event.target.value)}
        aria-label="Network"
      >
        {networks.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
