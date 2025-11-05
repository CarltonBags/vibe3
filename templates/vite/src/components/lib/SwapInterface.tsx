import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowDownUp } from "lucide-react"

export function SwapInterface() {
  const [fromAmount, setFromAmount] = React.useState("")

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Swap Tokens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">From</div>
          <div className="flex items-center gap-2 p-4 border rounded-lg">
            <div className="h-8 w-8 rounded-full bg-primary/20" />
            <div className="flex-1">
              <div className="font-semibold">ETH</div>
              <div className="text-xs text-muted-foreground">Ethereum</div>
            </div>
            <Input
              type="number"
              placeholder="0.0"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              className="text-right border-0 focus-visible:ring-0 focus-visible:ring-offset-0 max-w-[120px]"
            />
          </div>
        </div>

        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full h-10 w-10 p-0">
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">To</div>
          <div className="flex items-center gap-2 p-4 border rounded-lg">
            <div className="h-8 w-8 rounded-full bg-primary/20" />
            <div className="flex-1">
              <div className="font-semibold">USDC</div>
              <div className="text-xs text-muted-foreground">USD Coin</div>
            </div>
            <div className="text-right max-w-[120px]">
              <div className="font-semibold">0.0</div>
            </div>
          </div>
        </div>

        <Button className="w-full">Swap</Button>
      </CardContent>
    </Card>
  )
}

