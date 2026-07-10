import { Nav } from '@/components/sections/Nav'
import { Hero } from '@/components/sections/Hero'
import { HowItWorks } from '@/components/sections/HowItWorks'
import { FeatureShowcase } from '@/components/sections/FeatureShowcase'
import { Studio } from '@/components/sections/Studio'
import { Why } from '@/components/sections/Why'
import { Faq } from '@/components/sections/Faq'
import { Setup } from '@/components/sections/Setup'
import { Download } from '@/components/sections/Download'
import { Footer } from '@/components/sections/Footer'

export default function App() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureShowcase />
        <Studio />
        <Why />
        <Setup />
        <Faq />
        <Download />
      </main>
      <Footer />
    </div>
  )
}
