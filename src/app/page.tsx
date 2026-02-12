import Link from "next/link";

export default function Home() {
  return (
    <section className="space-y-6">
      <div className="panel p-7">
        <h1 className="font-display text-4xl leading-tight">
          Unlock SME cash flow with on-chain invoice claims.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-300">
          InvoiceVault notarizes invoice hashes, tokenizes claims, and supports
          discounted funding in a clean 3-step workflow for demo-ready RWA finance.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="btn" href="/create">
            1. Create Invoice
          </Link>
          <Link className="btn" href="/marketplace">
            2. Fund Marketplace
          </Link>
          <Link className="btn" href="/portfolio">
            3. Portfolio & Repay
          </Link>
        </div>
      </div>
    </section>
  );
}
