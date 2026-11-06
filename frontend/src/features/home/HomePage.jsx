import { useApiHealth } from '../../hooks'
import { APP_CONFIG } from '../../config'
import HeroBanner from './components/HeroBanner'
import PlannedModuleCard from './components/PlannedModuleCard'

export function HomePage() {
  const { statusText } = useApiHealth()

  return (
    <div className="p-8 md:p-14">
      <section className="mx-auto max-w-4xl space-y-8">
        <HeroBanner apiStatus={statusText} />
        <section aria-label="Planned modules" className="grid md:grid-cols-2 gap-4">
          {APP_CONFIG.plannedModules.map((item) => (
            <PlannedModuleCard
              key={item.title}
              title={item.title}
              description={item.description}
              status={item.status}
            />
          ))}
        </section>
      </section>
    </div>
  )
}

export default HomePage
