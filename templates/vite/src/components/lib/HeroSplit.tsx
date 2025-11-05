import * as React from "react"
import { Button } from "@/components/ui/button"

export function HeroSplit() {
  return (
    <section className="container py-20 md:py-32">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-16 items-center">
        <div className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Subtitle</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Your Heading Here
          </h1>
          <p className="text-lg text-muted-foreground sm:text-xl">
            A compelling description that clearly explains the value proposition
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Button>Get Started</Button>
            <Button variant="outline">Learn More</Button>
          </div>
        </div>
        <div className="relative">
          <img
            src="/placeholder.svg"
            alt="Hero image"
            className="rounded-lg object-cover w-full h-auto"
          />
        </div>
      </div>
    </section>
  )
}
