import * as React from "react"

export function Timeline() {
  return (
    <section className="container py-16">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="text-center space-y-2 mb-12">
          <h2 className="text-3xl font-bold">Timeline</h2>
        </div>
        <div className="relative">
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />
          <div className="space-y-8">
            {/* Timeline items will be added by parent component */}
          </div>
        </div>
      </div>
    </section>
  )
}
