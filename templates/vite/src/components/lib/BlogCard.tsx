import * as React from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar, User } from "lucide-react"

export function BlogCard() {
  return (
    <Card className="group hover:shadow-lg transition-all overflow-hidden">
      <div className="relative h-48 w-full overflow-hidden">
        <img
          src="/placeholder.svg"
          alt="Blog post"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <CardHeader>
        <span className="text-xs font-semibold text-primary mb-2">Category</span>
        <CardTitle className="line-clamp-2">Blog Post Title</CardTitle>
        <CardDescription className="line-clamp-2">Blog post excerpt or summary</CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col gap-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground w-full">
          <div className="flex items-center gap-1">
            <User className="h-4 w-4" />
            <span>Author Name</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            <span>Date</span>
          </div>
        </div>
        <Button variant="outline" className="w-full">Read More</Button>
      </CardFooter>
    </Card>
  )
}
