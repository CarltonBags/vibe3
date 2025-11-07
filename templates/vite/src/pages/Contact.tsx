import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Phone, Mail, MapPin, Clock } from 'lucide-react'

function Contact() {
  return (
    <div className="px-4 py-16 sm:px-8 lg:px-16">
      <div className="mx-auto max-w-5xl space-y-12">
        <div className="space-y-4 text-center">
          <Badge variant="outline" className="border-accent-pink/40 text-accent-pink">
            Let&apos;s collaborate
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Tell us about your dream experience</h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Share your brand direction, target audience, and desired vibe. We&apos;ll infuse everything into a show-stopping landing page with immersive visuals and irresistible storytelling.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border border-accent-pink/30 bg-background/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Send a message</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <Input placeholder="Astra Nova" className="bg-background/60" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <Input type="email" placeholder="hello@chromatic.studio" className="bg-background/60" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Project type</label>
                <Input placeholder="Flamboyant landing page for a neon fintech brand" className="bg-background/60" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Vision</label>
                <Textarea
                  rows={4}
                  placeholder="Describe the energy, colors, and sections you want to see. Mention any imagery you plan to upload."
                  className="bg-background/60"
                />
              </div>

              <Button className="w-full rounded-full bg-accent-pink text-primary-foreground hover:bg-accent-pink/90">
                Submit brief
              </Button>
            </CardContent>
          </Card>

          <Card className="border border-accent-blue/30 bg-background/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Contact & availability</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-sm text-muted-foreground">
              <div className="grid gap-4">
                <div className="flex items-center gap-3 rounded-2xl border border-accent-blue/30 bg-background/60 p-4">
                  <Phone className="h-5 w-5 text-accent-blue" />
                  <div>
                    <p className="text-foreground">Direct line</p>
                    <p>+1 (555) 240-9020</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-accent-pink/30 bg-background/60 p-4">
                  <Mail className="h-5 w-5 text-accent-pink" />
                  <div>
                    <p className="text-foreground">Email</p>
                    <p>creative@vibe.studio</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-tertiary/30 bg-background/60 p-4">
                  <MapPin className="h-5 w-5 text-tertiary" />
                  <div>
                    <p className="text-foreground">Studio</p>
                    <p>Helix Avenue 88, Neon District</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-accent-blue/30 bg-background/60 p-4">
                  <Clock className="h-5 w-5 text-accent-blue" />
                  <div>
                    <p className="text-foreground">Response time</p>
                    <p>We reply within 12 hours on business days.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-accent-pink/30 bg-gradient-to-br from-accent-pink/10 via-background to-accent-blue/10 p-6">
                <h3 className="text-lg font-semibold text-foreground">Need imagery?</h3>
                <p className="mt-2">
                  Upload product shots or request AI-generated hero art. We support cinematic renders, abstract shapes, and neon-lit scenes tailored to your copy.
                </p>
                <Button variant="outline" className="mt-4 w-full border-accent-pink/40 text-accent-pink">
                  Enable hero image creation
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Contact

