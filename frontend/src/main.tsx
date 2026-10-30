import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'

const container = document.getElementById('root')

const root = createRoot(container!)

// StrictMode is intentionally off: its dev double-mount would open duplicate SSH sessions.
root.render(<App/>)
