import { Routes, Route } from 'react-router-dom'
import { MainLayout } from '../components/layout'
import { HomePage } from '../features/home/HomePage'

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
      </Route>
    </Routes>
  )
}
