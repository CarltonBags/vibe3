import * as React from "react"
import { Link } from "react-router-dom"

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border/70 bg-background/95 text-sm text-muted-foreground">
      <div className="container grid gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-foreground">
            <span className="rounded-full bg-accent-blue/15 px-3 py-1 text-xs font-semibold text-accent-blue">WL</span>
            <span className="text-lg font-semibold tracking-wide">Waterlend</span>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Waterlend is the institutional-grade liquidity hub for decentralized teams. Borrow responsibly,
            deploy capital efficiently, and monitor portfolios with real-time intelligence.
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/80">Ecosystem</h4>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <Link to="/borrow" className="transition hover:text-accent-blue">
                Borrow Desk
              </Link>
            </li>
            <li>
              <Link to="/lend" className="transition hover:text-accent-blue">
                Lend Marketplace
              </Link>
            </li>
            <li>
              <Link to="/dashboard" className="transition hover:text-accent-blue">
                Portfolio Dashboard
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/80">Compliance</h4>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <a href="mailto:support@waterlend.ai" className="transition hover:text-accent-blue">
                support@waterlend.ai
              </a>
            </li>
            <li>
              <a href="https://waterlend.ai/security" target="_blank" rel="noreferrer" className="transition hover:text-accent-blue">
                Security & Audits
              </a>
            </li>
            <li>
              <a href="https://waterlend.ai/terms" target="_blank" rel="noreferrer" className="transition hover:text-accent-blue">
                Terms & Privacy
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/60 bg-background/80 py-6">
        <div className="container flex flex-col gap-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>© {year} Waterlend Labs. All rights reserved.</span>
          <span>Smart contract infrastructure audited quarterly. SOC2 Type II certified.</span>
        </div>
      </div>
    </footer>
  )
}
