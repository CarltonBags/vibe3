import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function TeamCard() {
  return (
    <Card className="text-center">
      <CardContent className="pt-6 space-y-4">
        <div className="flex justify-center">
          <Avatar className="h-24 w-24">
            <AvatarImage src="" alt="Team Member" />
            <AvatarFallback className="text-2xl">TM</AvatarFallback>
          </Avatar>
        </div>
        <div>
          <h3 className="text-lg font-semibold">Team Member</h3>
          <p className="text-sm text-muted-foreground">Role</p>
        </div>
        <p className="text-sm text-muted-foreground">Team member bio goes here</p>
      </CardContent>
    </Card>
  )
}
