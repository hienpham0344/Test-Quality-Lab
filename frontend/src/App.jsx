import AppRoutes from './routes'
import { AuthProvider } from './features/auth/AuthProvider'

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
