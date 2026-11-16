import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {NotificationProvider} from './Notifications'

const container = document.getElementById('root')

const root = createRoot(container!)

// StrictMode is intentionally off: its dev double-mount would open duplicate SSH sessions.
root.render(<NotificationProvider><App/></NotificationProvider>)
