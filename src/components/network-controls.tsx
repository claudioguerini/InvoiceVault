"use client";

import { useNetworkState } from "@/components/app-providers";

export function NetworkControls() {
  const { network, networks, selectNetwork } = useNetworkState();

  return (
    <div className="flex min-w-0 items-center">
      <select
        className="h-9 min-w-[154px] rounded-[13px] border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,32,0.94),rgba(7,13,24,0.88))] px-3.5 text-sm font-semibold tracking-[0.01em] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-cyan-300/45 focus:shadow-[0_0_0_1px_rgba(105,231,255,0.16)]"
        style={{ colorScheme: "dark" }}
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
