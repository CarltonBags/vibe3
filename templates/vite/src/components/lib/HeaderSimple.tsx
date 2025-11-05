import * as React from "react"
import { Button } from "@/components/ui/button"

export function HeaderSimple() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="container flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">Logo</span>
        </div>
        
        <nav className="hidden md:flex items-center gap-6">
          {/* Navigation items will be added by parent component */}
        </nav>

        <Button variant="outline">Get Started</Button>
      </div>
    </header>
  )
}
