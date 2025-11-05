import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TrendingUp } from "lucide-react"

export function StakingCard() {
  const [amount, setAmount] = React.useState("")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stake ETH</CardTitle>
        <CardDescription>
          <div className="flex items-center gap-2 mt-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="font-semibold text-green-500">5.0% APY</span>
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Staked</span>
            <span className="font-semibold">0 ETH</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Available</span>
            <span className="font-semibold">0 ETH</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stake-amount">Amount</Label>
          <Input
            id="stake-amount"
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="outline">25%</Button>
            <Button variant="outline">50%</Button>
            <Button variant="outline">Max</Button>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button className="flex-1">Stake</Button>
        <Button variant="outline" className="flex-1">Unstake</Button>
      </CardFooter>
    </Card>
  )
}
