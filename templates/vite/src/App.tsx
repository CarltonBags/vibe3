import { Routes, Route } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'

import { Header } from '@/components/lib/Header'
import { Footer } from '@/components/lib/Footer'
import { Toaster } from '@/components/ui/sonner'
import Home from '@/pages/Home'


function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-dark via-background to-secondary-dark text-foreground flex flex-col">
      <Helmet>
        <title>Vibe – AI Crafted Experiences</title>
        <meta
          name="description"
          content="Launch cinematic, conversion-ready landing pages with Vibe's AI-crafted React + Tailwind template."
        />
        <link rel="canonical" href="https://example.com/" />
      </Helmet>

      <div className="absolute inset-0 -z-10 overflow-hidden opacity-60">
        <div className="absolute top-[-20%] left-[-10%] h-96 w-96 rounded-full bg-accent-blue blur-3xl" />
        <div className="absolute bottom-[-30%] right-[-10%] h-[420px] w-[420px] rounded-full bg-accent-pink blur-[180px]" />
        <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-tertiary blur-[150px]" />
      </div>

      <Header />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </main>

      <Footer />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  )
}

export default App