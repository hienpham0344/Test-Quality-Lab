export const APP_CONFIG = {
  name: 'Test Quality Lab',
  version: '0.1.0',
  description: 'Build trustworthy Python test evaluations.',
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  plannedModules: [
    {
      title: 'Authentication',
      description: 'Role-based access and user sessions',
      status: 'Planned · not implemented',
    },
    {
      title: 'Python & CSV import',
      description: 'Upload datasets and test case suites',
      status: 'Planned · not implemented',
    },
    {
      title: 'Experiments and L1–L5',
      description: 'Configure and evaluate prompt quality levels',
      status: 'Planned · not implemented',
    },
    {
      title: 'Reports & metrics',
      description: 'Benchmark comparisons and test quality analytics',
      status: 'Planned · not implemented',
    },
  ],
}
