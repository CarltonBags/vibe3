import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"

export function PricingCard() {
  return (
    <Card className="relative flex flex-col">
      <CardHeader>
        <CardTitle>Plan Name</CardTitle>
        <CardDescription>Plan description</CardDescription>
        <div className="mt-4">
          <span className="text-4xl font-bold">$99</span>
          <span className="text-muted-foreground">/month</span>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        <ul className="space-y-3">
          <li className="flex items-start gap-2">
            <Check className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <span className="text-sm">Feature 1</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <span className="text-sm">Feature 2</span>
          </li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Get Started</Button>
      </CardFooter>
    </Card>
  )
}
