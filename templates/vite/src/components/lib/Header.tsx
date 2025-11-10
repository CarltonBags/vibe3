import * as React from "react"
import { Button } from "@/components/ui/button"
import { Menu, X } from "lucide-react"
import { Link } from "react-router-dom"

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-xl font-bold hover:text-accent transition-colors">
            Vibe
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          <Link to="/" className="text-sm font-medium hover:text-accent transition-colors">
            Home
          </Link>
          <Link to="/showcase" className="text-sm font-medium hover:text-accent transition-colors">
            Showcase
          </Link>
          <Link to="/contact" className="text-sm font-medium hover:text-accent transition-colors">
            Contact
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <Button>Get Started</Button>
        </div>

        <button
          className="md:hidden"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="container px-4 py-4 space-y-3">
            <Link
              to="/"
              className="block text-sm font-medium hover:text-accent transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Home
            </Link>
            <Link
              to="/showcase"
              className="block text-sm font-medium hover:text-accent transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Showcase
            </Link>
            <Link
              to="/contact"
              className="block text-sm font-medium hover:text-accent transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Contact
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
