import * as React from "react"

export function Steps() {
  return (
    <section className="container py-16">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="text-center space-y-2 mb-12">
          <h2 className="text-3xl font-bold">How It Works</h2>
          <p className="text-muted-foreground">Simple steps to get started</p>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background">
                <span className="text-2xl font-bold">1</span>
              </div>
            </div>
            <h3 className="text-lg font-semibold">Step 1</h3>
            <p className="text-sm text-muted-foreground">Step description</p>
          </div>
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background">
                <span className="text-2xl font-bold">2</span>
              </div>
            </div>
            <h3 className="text-lg font-semibold">Step 2</h3>
            <p className="text-sm text-muted-foreground">Step description</p>
          </div>
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background">
                <span className="text-2xl font-bold">3</span>
              </div>
            </div>
            <h3 className="text-lg font-semibold">Step 3</h3>
            <p className="text-sm text-muted-foreground">Step description</p>
          </div>
        </div>
      </div>
    </section>
  )
}
