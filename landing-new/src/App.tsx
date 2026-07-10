import { Nav } from '@/components/sections/Nav'
import { Hero } from '@/components/sections/Hero'
import { Futuristic } from '@/components/sections/Futuristic'
import { AppShowcase } from '@/components/sections/AppShowcase'
import { FeatureShowcase } from '@/components/sections/FeatureShowcase'
import { OrbitalFeatures } from '@/components/sections/OrbitalFeatures'
import { Studio } from '@/components/sections/Studio'
import { Differentiators } from '@/components/sections/Differentiators'
import { Download } from '@/components/sections/Download'
import { Footer } from '@/components/sections/Footer'

export default function App() {
  return (
    <div className="relative min-h-dvh bg-[var(--bg)] text-[var(--fg)]">
      <Nav />
      <main>
        <Hero />
        <Futuristic />
        <AppShowcase />
        <FeatureShowcase />
        <OrbitalFeatures />
        <Studio />
        <Differentiators />
        <Download />
      </main>
      <Footer />
    </div>
  )
}
