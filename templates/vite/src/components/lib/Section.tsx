import * as React from "react"

export function Section({ children }: { children?: React.ReactNode }) {
  return (
    <section className="py-16 md:py-24">
      <div className="container px-4">
        {children}
      </div>
    </section>
  )
}
