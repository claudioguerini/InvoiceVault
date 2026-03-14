import Link from "next/link";

const metrics = [
  {
    label: "Built On",
    value: "IOTA",
    caption: "A receivables flow designed for visible proof, fast movement and auditable history.",
  },
  {
    label: "From PDF",
    value: "To Funding",
    caption: "Hash, notarize, mint and list without leaving the product surface.",
  },
  {
    label: "Lifecycle",
    value: "End To End",
    caption: "Creation, buyer entry and repayment stay connected in one operational rail.",
  },
];

const phases = [
  {
    title: "01. Anchor Proof",
    body: "Hash the invoice client-side and notarize the fingerprint on IOTA before the claim ever reaches the market.",
  },
  {
    title: "02. Open Liquidity",
    body: "Turn the receivable into an investable on-chain position with pricing, yield context and seller visibility.",
  },
  {
    title: "03. Manage Outcome",
    body: "Track repayment, default or recovery with a clear audit trail instead of fragmented back-office updates.",
  },
];

const capabilityCards = [
  {
    title: "Issuers Launch Faster",
    body: "InvoiceVault turns a static PDF into a finance-ready digital claim with proof already attached, so the path to funding starts immediately.",
  },
  {
    title: "Buyers See More",
    body: "Instead of guessing from a spreadsheet row, buyers can read yield, seller quality and lifecycle state in one premium market surface.",
  },
  {
    title: "Teams Stay In Control",
    body: "Creation, marketplace action and portfolio monitoring stay connected, so operations feel like one product instead of three disjointed tools.",
  },
];

export default function Home() {
  return (
    <section className="space-y-8">
      <div className="page-hero grid gap-8 px-6 py-8 sm:px-8 sm:py-9 xl:grid-cols-[minmax(0,1.1fr)_24rem] xl:items-stretch">
        <div className="flex flex-col justify-between">
          <div>
            <p className="eyebrow">Invoice Financing On IOTA</p>
            <h1 className="hero-title mt-5 max-w-4xl text-white">
              Turn every invoice into a finance-ready on-chain asset.
            </h1>
            <p className="hero-copy mt-6 max-w-2xl">
              InvoiceVault is the final product surface for businesses and buyers who want to
              move receivables through proof, funding and repayment on IOTA. Upload the PDF,
              anchor the fingerprint, open the claim to the market and manage the full lifecycle
              from a single high-trust interface.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className="btn" href="/create#launch-guide" scroll={false}>
                Start An Invoice
              </Link>
              <Link className="btn-secondary" href="/marketplace">
                Explore Funding
              </Link>
            </div>
            <div className="mt-5 rounded-[24px] border border-white/10 bg-white/4 px-4 py-4">
              <p className="metric-label">Why Start Here</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Begin in `Create` to mint a receivable on IOTA, move to `Marketplace` to price or
                fund it, then track repayment and trust signals in `Portfolio`.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="metric-card px-4 py-4">
                <p className="metric-label">{metric.label}</p>
                <p className="metric-value mt-4 text-[2rem]">{metric.value}</p>
                <p className="metric-caption mt-3">{metric.caption}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-strong flex flex-col justify-between px-5 py-5">
          <div>
            <p className="eyebrow">Why It Converts</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This is not a passive dashboard. It is a product designed to turn proof into
              funding intent and funding intent into action.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {phases.map((phase, index) => (
              <div
                key={phase.title}
                className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,17,31,0.92),rgba(6,11,22,0.82))] px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-100">{phase.title}</p>
                  <span className="chip border-white/10 bg-white/4 text-slate-200">
                    Stage {index + 1}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{phase.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[24px] border border-cyan-300/18 bg-[linear-gradient(135deg,rgba(105,231,255,0.12),rgba(122,255,198,0.08))] px-4 py-4">
            <p className="metric-label">Product Promise</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
              Proof should accelerate capital, not slow it down.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-200/90">
              On IOTA, the receivable keeps its evidentiary backbone while the user gets a
              smoother path from upload to market participation.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)]">
        <div className="panel px-6 py-6 sm:px-7">
          <p className="eyebrow">Why Teams Choose It</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {capabilityCards.map((card) => (
              <div
                key={card.title}
                className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.86),rgba(6,11,22,0.76))] px-4 py-5"
              >
                <p className="text-lg font-semibold text-white">{card.title}</p>
                <p className="mt-3 text-sm leading-6 text-slate-300">{card.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-muted px-5 py-6">
          <p className="eyebrow">Overview</p>
          <p className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white">
            One product for proof, liquidity and lifecycle control.
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            InvoiceVault gives issuers and buyers a single front end for notarized receivables on
            IOTA. The goal is simple: help users trust what they see, understand what to do next,
            and take action without friction.
          </p>
          <div className="mt-6 space-y-3">
            <div className="rounded-[20px] border border-white/10 bg-white/4 px-4 py-3">
              <p className="metric-label">Create</p>
              <p className="mt-2 text-sm text-slate-200">
                Convert a document into an on-chain receivable with proof already built in.
              </p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/4 px-4 py-3">
              <p className="metric-label">Marketplace</p>
              <p className="mt-2 text-sm text-slate-200">
                Present yield, trust and timing in a way buyers can act on immediately.
              </p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/4 px-4 py-3">
              <p className="metric-label">Portfolio</p>
              <p className="mt-2 text-sm text-slate-200">
                Keep repayment, recovery and ratings visible long after origination.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
