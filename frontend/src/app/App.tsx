import { Route, Routes } from 'react-router-dom'
import { HomePage } from '../features/home/HomePage'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage'

export function App() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
  </Routes>
}
