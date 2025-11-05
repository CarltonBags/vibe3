import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"

export function LiquidityPoolTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Liquidity Pools</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pair</TableHead>
              <TableHead className="text-right">TVL</TableHead>
              <TableHead className="text-right">24h Volume</TableHead>
              <TableHead className="text-right">APY</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Pool rows will be added by parent component */}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
