import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"

export function TokenBalance() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20" />
            <div>
              <div className="font-semibold">ETH</div>
              <div className="text-sm text-muted-foreground">Ethereum</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold">0.0</div>
            <div className="text-sm text-muted-foreground">$0.00</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
