import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart } from "lucide-react"

export function ProductCard() {
  return (
    <Card className="group hover:shadow-lg transition-all overflow-hidden flex flex-col">
      <div className="relative h-64 w-full overflow-hidden bg-muted">
        <img
          src="/placeholder.svg"
          alt="Product"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <Badge className="absolute top-2 right-2">New</Badge>
      </div>
      <CardHeader className="flex-grow">
        <CardTitle>Product Name</CardTitle>
        <CardDescription className="line-clamp-2">Product description</CardDescription>
      </CardHeader>
      <CardFooter className="flex items-center justify-between">
        <span className="text-2xl font-bold">$99.00</span>
        <Button>
          <ShoppingCart className="h-4 w-4 mr-2" />
          Add to Cart
        </Button>
      </CardFooter>
    </Card>
  )
}
