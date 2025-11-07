import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Shield, Zap, Globe, TrendingUp, Star } from 'lucide-react'

function Home() {
  return (
    <div className="relative overflow-hidden">
      <section className="relative px-4 pt-12 pb-24 sm:px-8 lg:px-16">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary-dark via-background to-secondary-dark" />
        <div className="absolute inset-0 -z-[1] opacity-40">
          <div className="absolute -top-24 -left-16 h-64 w-64 rounded-full bg-accent-pink blur-3xl" />
          <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-accent-blue blur-[150px]" />
        </div>

        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-8 text-center lg:text-left">
            <Badge variant="outline" className="mx-auto w-fit border-accent-pink/70 text-accent-pink lg:mx-0">
              Launch something remarkable today
            </Badge>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-primary-foreground sm:text-5xl lg:text-6xl">
              Vivid experiences, crafted in minutes
            </h1>
            <p className="text-lg text-muted-foreground sm:text-xl">
              Build immersive digital products with cinematic hero sections, animated interactions, and expressive visuals.
              Your landing page should never be boring—let&apos;s make it electric.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button size="lg" className="h-12 rounded-full px-8 text-lg">
                Start creating
              </Button>
              <Button size="lg" variant="outline" className="h-12 rounded-full border-accent-pink/50 px-8 text-lg text-accent-pink">
                Watch the magic
              </Button>
            </div>

            <div className="grid gap-6 pt-6 sm:grid-cols-3">
              <Card className="bg-background/60 backdrop-blur border-accent-blue/30">
                <CardHeader className="space-y-2">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Sparkles className="h-5 w-5 text-accent-pink" />
                    Flamboyant hero visuals
                  </CardTitle>
                  <CardContent className="px-0 text-sm text-muted-foreground">
                    Cinematic gradients, animated particles, and on-brand imagery right out of the box.
                  </CardContent>
                </CardHeader>
              </Card>
              <Card className="bg-background/60 backdrop-blur border-tertiary/30">
                <CardHeader className="space-y-2">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <TrendingUp className="h-5 w-5 text-tertiary" />
                    Conversion-ready sections
                  </CardTitle>
                  <CardContent className="px-0 text-sm text-muted-foreground">
                    Features, testimonials, pricing, FAQs, and social proof woven together beautifully.
                  </CardContent>
                </CardHeader>
              </Card>
              <Card className="bg-background/60 backdrop-blur border-accent-blue/30">
                <CardHeader className="space-y-2">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Shield className="h-5 w-5 text-accent-blue" />
                    Pixel-perfect defaults
                  </CardTitle>
                  <CardContent className="px-0 text-sm text-muted-foreground">
                    Semantic Tailwind tokens guarantee dark-mode harmony and crisp contrast.
                  </CardContent>
                </CardHeader>
              </Card>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-accent-pink/60 via-transparent to-accent-blue/40 blur-2xl" />
            <div className="relative overflow-hidden rounded-3xl border border-accent-blue/30 bg-background/90 shadow-2xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.15),_rgba(0,0,0,0))]" />
              <img
                src="https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&w=1000&q=80"
                alt="Futuristic dashboard"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 left-1/2 w-full max-w-xs -translate-x-1/2 rounded-2xl border border-primary/40 bg-background/80 p-4 text-center shadow-xl backdrop-blur">
              <p className="text-sm text-muted-foreground">
                Upload moodboards or on-brand imagery to influence hero art. AI-generated visuals now supported.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-24 sm:px-8 lg:px-16">
        <div className="mx-auto max-w-6xl space-y-16">
          <div className="text-center space-y-4">
            <Badge variant="secondary" className="border border-accent-blue/40 bg-accent-blue/10 text-accent-blue">
              Sensational sections
            </Badge>
            <h2 className="text-3xl font-bold sm:text-4xl">Everything a luminous landing page needs</h2>
            <p className="mx-auto max-w-3xl text-muted-foreground text-lg">
              Every build starts with a hero, narrative, testimonials, pricing, FAQs, and a punchy call-to-action.
              You&apos;ll never launch with an empty canvas again.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <Card className="border border-accent-pink/20 bg-background/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <Zap className="h-6 w-6 text-accent-pink" />
                  Signature hero layouts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-muted-foreground">
                <p>
                  Animated gradients, kinetic typography, spotlight images, and layered glassmorphism are included by default.
                </p>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center gap-2"><Star className="h-4 w-4 text-accent-pink" /> Particle overlays with subtle parallax</li>
                  <li className="flex items-center gap-2"><Star className="h-4 w-4 text-tertiary" /> Dynamic highlight badges for social proof</li>
                  <li className="flex items-center gap-2"><Star className="h-4 w-4 text-accent-blue" /> Spotlight area for your hero imagery</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border border-tertiary/20 bg-background/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <Globe className="h-6 w-6 text-tertiary" />
                  Conversion first storytelling
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-muted-foreground">
                <p>
                  Feature grids, glowing statistic cards, a gallery carousel, testimonials, and pricing tiers ship fully styled.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-accent-blue/30 bg-gradient-to-br from-accent-blue/10 via-background to-background p-4">
                    <p className="text-3xl font-bold text-accent-blue">98%</p>
                    <p className="text-sm text-muted-foreground">Users launch without manual tweaks</p>
                  </div>
                  <div className="rounded-2xl border border-accent-pink/30 bg-gradient-to-br from-accent-pink/10 via-background to-background p-4">
                    <p className="text-3xl font-bold text-accent-pink">24hrs</p>
                    <p className="text-sm text-muted-foreground">Average time to production</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border border-accent-blue/20 bg-background/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <Sparkles className="h-6 w-6 text-accent-blue" />
                  Testimonial spotlight
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-muted-foreground">
                <p className="text-lg text-foreground">
                  “The generated landing page looked like a creative agency spent a week on it. It had depth, motion, and context-aware imagery that matched our vibe perfectly.”
                </p>
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent-pink/40" />
                  <div>
                    <p className="font-medium text-foreground">Nova Martins</p>
                    <p className="text-sm text-muted-foreground">Founder, Chromatic Labs</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-3xl border border-accent-pink/30 bg-gradient-to-br from-background via-background/70 to-accent-pink/20 p-8">
              <h3 className="text-2xl font-semibold text-primary-foreground">Upload imagery → Get cinematic compositions</h3>
              <p className="mt-4 text-sm text-muted-foreground">
                Provide brand photography or mood boards. We blend them with neon gradients, glass cards, holographic shapes, and glowing call-to-actions.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="aspect-square overflow-hidden rounded-2xl border border-accent-blue/30">
                  <img
                    src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=600&q=80"
                    alt="Team collaborating"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="aspect-square overflow-hidden rounded-2xl border border-accent-pink/30">
                  <img
                    src="https://images.unsplash.com/photo-1523475472560-d2df97ec485c?auto=format&fit=crop&w=600&q=80"
                    alt="Designer desk with neon light"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <Button className="mt-8 w-full rounded-full bg-accent-blue text-primary-foreground hover:bg-accent-blue/90">
                Enable image-powered hero sections
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-24 sm:px-8 lg:px-16">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-accent-blue/30 bg-background/80 p-12 text-center shadow-2xl backdrop-blur">
          <Badge variant="outline" className="border-tertiary/40 text-tertiary">
            Ready when you are
          </Badge>
          <h2 className="mt-6 text-3xl font-bold sm:text-4xl">Launch something unforgettable today</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Your default build includes all the expected sections, tuned for dark mode and dripping with personality.
            Drop your prompt, upload a reference image, and watch the hero come alive.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" className="h-12 rounded-full px-9 text-base">
              Generate my landing page
            </Button>
            <Button size="lg" variant="outline" className="h-12 rounded-full border-accent-pink/40 px-9 text-base text-accent-pink">
              Explore vibrant examples
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Home

