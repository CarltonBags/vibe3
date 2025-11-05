import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function TestimonialCard() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-4 text-sm text-muted-foreground">"Testimonial quote goes here"</p>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src="" alt="Author" />
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">Author Name</p>
            <p className="text-xs text-muted-foreground">Role</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
