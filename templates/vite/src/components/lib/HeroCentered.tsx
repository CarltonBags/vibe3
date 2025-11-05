import * as React from "react"
import { Button } from "@/components/ui/button"

export function HeroCentered() {
  return (
    <section className="flex min-h-[500px] flex-col items-center justify-center px-4 py-20 text-center">
      <div className="container z-10 space-y-6 max-w-4xl">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Welcome</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Your Heading Here
        </h1>
        <p className="mx-auto max-w-[700px] text-lg text-muted-foreground sm:text-xl">
          A compelling description that clearly explains the value proposition
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button>Get Started</Button>
          <Button variant="outline">Learn More</Button>
        </div>
      </div>
    </section>
  )
}
