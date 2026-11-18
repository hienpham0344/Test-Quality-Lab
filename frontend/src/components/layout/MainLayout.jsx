import { Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import { GhostCursor } from '../common'

export default function MainLayout({ signedIn, signingOut, onSignOut }) {
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <GhostCursor
        color="#B497CF"
        size={80}
        trailLength={50}
        inertia={0.5}
        turbulence={0.5}
        drift={0.3}
        bloomStrength={0.6}
        grainIntensity={0.05}
        zIndex={1}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
      />
      <div className="relative z-10 flex flex-col flex-1">
        <Header signedIn={signedIn} signingOut={signingOut} onSignOut={onSignOut} />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  )
}
