import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TrendingUp, TrendingDown } from "lucide-react"

export function LendingInterface() {
  const [amount, setAmount] = React.useState("")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lend & Borrow</CardTitle>
        <CardDescription>Supply assets to earn interest or borrow against your collateral</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="supply" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="supply">Supply</TabsTrigger>
            <TabsTrigger value="borrow">Borrow</TabsTrigger>
          </TabsList>

          <TabsContent value="supply" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="supply-asset">Asset</Label>
              <select
                id="supply-asset"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option>ETH - 3% APY</option>
                <option>USDC - 5% APY</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supply-amount">Amount</Label>
              <Input
                id="supply-amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span>Available: 0</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1">Supply</Button>
              <Button variant="outline" className="flex-1">Withdraw</Button>
            </div>
          </TabsContent>

          <TabsContent value="borrow" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="borrow-asset">Asset</Label>
              <select
                id="borrow-asset"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option>ETH - 5% APR</option>
                <option>USDC - 7% APR</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="borrow-amount">Amount</Label>
              <Input
                id="borrow-amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <span>Borrowable: 0</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1">Borrow</Button>
              <Button variant="outline" className="flex-1">Repay</Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
