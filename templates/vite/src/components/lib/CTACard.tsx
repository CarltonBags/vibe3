import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Zap } from "lucide-react"

export function CTACard() {
  return (
    <Card className="group hover:shadow-lg transition-all">
      <CardHeader>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
          <Zap className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Get Started</CardTitle>
        <CardDescription>Description text goes here</CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:w-auto">Get Started</Button>
        <Button variant="ghost" className="w-full sm:w-auto">Learn More</Button>
      </CardFooter>
    </Card>
  )
}
