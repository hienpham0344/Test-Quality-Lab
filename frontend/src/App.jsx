import { useState } from 'react'
import AppRoutes from './routes'

export function App() {
  const [session, setSession] = useState(null)
  return <AppRoutes session={session} onSignIn={setSession} />
}

export default App
