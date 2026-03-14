"use client";

type QuickAccessItem = {
  href: string;
  kicker: string;
  title: string;
  detail: string;
  badge?: string;
  emphasis?: boolean;
};

function gridClassName(itemCount: number) {
  if (itemCount >= 3) return "md:grid-cols-2 xl:grid-cols-3";
  if (itemCount === 2) return "md:grid-cols-2";
  return "";
}

export function QuickAccessStrip(props: {
  label?: string;
  summary: string;
  items: QuickAccessItem[];
}) {
  const { items, label = "Quick Access", summary } = props;

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,27,0.92),rgba(6,11,21,0.84))] px-4 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
      <div className="max-w-2xl">
        <p className="metric-label">{label}</p>
        <p className="mt-2 text-sm leading-6 text-slate-200">{summary}</p>
      </div>

      <nav
        aria-label={label}
        className={`mt-4 grid gap-2 ${gridClassName(items.length)}`}
      >
        {items.map((item) => (
          <a
            key={`${item.href}-${item.title}`}
            href={item.href}
            className={`group rounded-[20px] border px-3.5 py-3 transition hover:-translate-y-[1px] hover:border-cyan-300/40 hover:bg-cyan-500/10 ${
              item.emphasis
                ? "border-cyan-300/24 bg-cyan-500/8"
                : "border-white/10 bg-white/4"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  {item.kicker}
                </p>
                <p className="mt-2 text-sm font-semibold text-white group-hover:text-cyan-100">
                  {item.title}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  item.emphasis
                    ? "border-cyan-300/22 bg-cyan-500/10 text-cyan-100"
                    : "border-white/10 bg-slate-950/40 text-slate-300"
                }`}
              >
                {item.badge ?? "Jump"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-300">{item.detail}</p>
          </a>
        ))}
      </nav>
    </div>
  );
}
