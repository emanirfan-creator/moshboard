import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './theme.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  Promise.all([import('./store'), import('./actions')]).then(([store, actions]) => Object.assign(window, { __mb: { ...store, ...actions } }))
}
