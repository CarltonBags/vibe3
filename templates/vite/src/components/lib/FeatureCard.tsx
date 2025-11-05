import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Zap } from "lucide-react"

export function FeatureCard() {
  return (
    <Card className="group hover:border-primary hover:shadow-lg transition-all">
      <CardHeader>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
          <Zap className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Feature Title</CardTitle>
        <CardDescription>Feature description goes here</CardDescription>
      </CardHeader>
    </Card>
  )
}
