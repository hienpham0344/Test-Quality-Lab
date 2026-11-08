import { Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'

export default function MainLayout({ signedIn, signingOut, onSignOut }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header signedIn={signedIn} signingOut={signingOut} onSignOut={onSignOut} />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
