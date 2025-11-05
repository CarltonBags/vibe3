import * as React from "react"
import { Button } from "@/components/ui/button"

export function CTA() {
  return (
    <section className="container py-16 md:py-24">
      <div className="mx-auto max-w-3xl text-center space-y-6">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
          Ready to get started?
        </h2>
        <p className="text-lg text-muted-foreground">
          Description text goes here
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button>Get Started</Button>
          <Button variant="outline">Learn More</Button>
        </div>
      </div>
    </section>
  )
}
