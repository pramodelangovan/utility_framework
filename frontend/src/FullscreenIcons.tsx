import {useFullscreen} from './FullscreenContext'

export function FullscreenIcon({active}: {active: boolean}) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {active
                ? <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>
                : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>}
        </svg>
    )
}

export function SidebarToggle() {
    const {sidebarVisible, toggleSidebar} = useFullscreen()
    const label = sidebarVisible ? 'Hide sidebar' : 'Show sidebar'
    return (
        <button type="button" className="secondary fullscreen-icon-button" aria-label={label} title={label}
                aria-controls="module-sidebar" aria-expanded={sidebarVisible} onClick={toggleSidebar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
        </button>
    )
}
