import * as React from "react"

export function Gallery() {
  return (
    <section className="container py-16">
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">Gallery</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Gallery images will be added by parent component */}
        </div>
      </div>
    </section>
  )
}
