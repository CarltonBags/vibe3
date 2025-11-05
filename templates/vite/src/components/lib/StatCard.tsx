import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"

export function StatCard() {
  return (
    <Card className="text-center">
      <CardContent className="pt-6">
        <div className="text-4xl font-bold text-primary mb-2">0</div>
        <div className="text-sm text-muted-foreground">Stat Label</div>
      </CardContent>
    </Card>
  )
}
