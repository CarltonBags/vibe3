import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { MonitorSmartphone, Palette, ReceiptEuro, Layers } from 'lucide-react'

function Showcase() {
  const galleryItems = [
    {
      title: 'Neon SaaS Landing',
      description: 'Glassmorphism hero, animated gradients, and layered metrics cards.',
      image: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1000&q=80'
    },
    {
      title: 'Holographic Portfolio',
      description: 'Split layout with interactive reel, testimonial slider, and glowing CTA.',
      image: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1000&q=80'
    },
    {
      title: 'Web3 Exchange',
      description: 'Dynamic stats, liquidity matrices, and immersive night-mode aesthetics.',
      image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1000&q=80'
    }
  ]

  return (
    <div className="px-4 py-20 sm:px-8 lg:px-16">
      <div className="mx-auto max-w-6xl space-y-16">
        <div className="space-y-4 text-center">
          <Badge variant="outline" className="border-accent-blue/40 text-accent-blue">
            Vibrant defaults showcase
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">What your first build already knows</h1>
          <p className="mx-auto max-w-3xl text-lg text-muted-foreground">
            Every project starts with curated sections for hero, features, stats, pricing, testimonials, FAQs, and a magnetic CTA.
            Personalize it or ship as-is—the launch-ready polish is part of the template.
          </p>
        </div>

        <div className="rounded-3xl border border-accent-blue/30 bg-background/80 p-8 shadow-2xl backdrop-blur">
          <Tabs defaultValue="hero" className="space-y-6">
            <TabsList className="grid grid-cols-2 gap-2 bg-background/60 p-2 sm:grid-cols-4">
              <TabsTrigger value="hero">Hero</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
              <TabsTrigger value="pricing">Pricing</TabsTrigger>
              <TabsTrigger value="cta">Call to action</TabsTrigger>
            </TabsList>

            <TabsContent value="hero">
              <Card className="border-none bg-gradient-to-br from-accent-pink/10 via-background to-accent-blue/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <MonitorSmartphone className="h-6 w-6 text-accent-blue" />
                    Cinematic hero arrangements
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                  <div className="space-y-4 text-muted-foreground">
                    <p>
                      Layered gradients, spotlight imagery, motion-ready badges, and shimmering call-to-actions ship right away.
                    </p>
                    <ul className="space-y-2 text-sm">
                      <li>• Particle overlays with depth aware blur</li>
                      <li>• Multi-tone glow rings accenting the hero visual</li>
                      <li>• Support for uploaded brand imagery or AI-generated art</li>
                    </ul>
                  </div>
                  <div className="overflow-hidden rounded-3xl border border-accent-blue/30">
                    <img
                      src="https://images.unsplash.com/photo-1526948128573-703ee1aeb6fa?auto=format&fit=crop&w=1000&q=80"
                      alt="Hero preview"
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="features">
              <Card className="border-none bg-gradient-to-br from-tertiary/10 via-background to-accent-blue/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <Layers className="h-6 w-6 text-tertiary" />
                    Feature storytelling that glows
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-2">
                  <Card className="border-accent-pink/30 bg-background/80">
                    <CardHeader>
                      <CardTitle className="text-lg">Gradient feature grid</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Three-column feature grid with animated hover states and accent gradients on icons.
                    </CardContent>
                  </Card>
                  <Card className="border-accent-blue/30 bg-background/80">
                    <CardHeader>
                      <CardTitle className="text-lg">Statistic halo cards</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Floating glass statistic cards with neon edges and dynamic counters ready for live data wiring.
                    </CardContent>
                  </Card>
                  <Card className="border-tertiary/30 bg-background/80">
                    <CardHeader>
                      <CardTitle className="text-lg">Testimonials carousel</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Auto cycling quotes, avatar rings, and context aware color accents.
                    </CardContent>
                  </Card>
                  <Card className="border-accent-pink/30 bg-background/80">
                    <CardHeader>
                      <CardTitle className="text-lg">FAQ accordions</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Accordion interactions with subtle micro-animations for each answer reveal.
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="pricing">
              <Card className="border-none bg-gradient-to-br from-accent-pink/10 via-background to-tertiary/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <ReceiptEuro className="h-6 w-6 text-accent-pink" />
                    Pricing that persuades
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-muted-foreground">
                    Tiered pricing cards with glowing outlines, plan badges, toggle switches, and gradient buttons.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {['Starter', 'Pro', 'Enterprise'].map((plan) => (
                      <Card key={plan} className="border border-accent-blue/30 bg-background/90">
                        <CardHeader>
                          <CardTitle className="text-lg">{plan}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                          <p>Includes hero, features, testimonials, and CTA sections tailored to your prompt.</p>
                          <Button variant="outline" className="w-full border-accent-blue/40">
                            Select plan
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cta">
              <Card className="border-none bg-gradient-to-r from-accent-blue/15 via-background to-accent-pink/15">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-2xl">
                    <Palette className="h-6 w-6 text-accent-blue" />
                    Dazzling call-to-action ribbons
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-muted-foreground">
                  <p>
                    Animated CTA ribbons with gradient glows, confetti sparkles, and supportive sub copy are included so leads always have a place to convert.
                  </p>
                  <Button size="lg" className="rounded-full bg-accent-blue text-primary-foreground hover:bg-accent-blue/90">
                    Launch my flamboyant landing page
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="rounded-3xl border border-accent-blue/20 bg-background/80 p-8 backdrop-blur">
          <h2 className="text-3xl font-semibold">Gallery of default hero renders</h2>
          <p className="mt-2 text-muted-foreground">
            Image creation is now built-in. Upload brand imagery or let AI synthesize dreamlike hero art to pair with your copy.
          </p>
          <Carousel className="mt-8">
            <CarouselContent>
              {galleryItems.map((item) => (
                <CarouselItem key={item.title} className="md:basis-1/3">
                  <Card className="overflow-hidden border border-accent-blue/30 bg-background/70">
                    <div className="aspect-[4/3] overflow-hidden">
                      <img src={item.image} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
                    </div>
                    <CardHeader className="space-y-2">
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                      <CardContent className="px-0 text-sm text-muted-foreground">
                        {item.description}
                      </CardContent>
                    </CardHeader>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </div>
      </div>
    </div>
  )
}

export default Showcase

