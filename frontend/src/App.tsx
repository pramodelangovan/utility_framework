import {useEffect, useRef, useState} from 'react'
import {WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen} from '../wailsjs/runtime/runtime'
import {plugins} from './plugins'
import {FullscreenContext} from './FullscreenContext'
import FullscreenBar from './FullscreenBar'
import {FullscreenIcon, SidebarToggle} from './FullscreenIcons'
import {useNotifications} from './NotificationContext'
import './style.css'

function App() {
    const notify = useNotifications()
    const [activeId, setActiveId] = useState(plugins[0]?.id)
    const [appFullscreen, setAppFullscreen] = useState(false)
    const [vncSession, setVncSession] = useState<string | null>(null)
    const [sidebarVisible, setSidebarVisible] = useState(true)
    const [pending, setPending] = useState(false)
    const [fullscreenError, setFullscreenError] = useState('')
    const windowOwned = useRef(false)
    const busy = useRef(false)
    const previousSidebar = useRef(false)
    const appFullscreenButton = useRef<HTMLButtonElement>(null)
    const restoreAppFocus = useRef(false)
    const activePlugin = plugins.find(p => p.id === activeId)

    useEffect(() => {
        const preventContextMenu = (event: MouseEvent) => event.preventDefault()
        document.addEventListener('contextmenu', preventContextMenu, true)
        return () => document.removeEventListener('contextmenu', preventContextMenu, true)
    }, [])

    useEffect(() => {
        if (!pending && restoreAppFocus.current) {
            appFullscreenButton.current?.focus({preventScroll: true})
            restoreAppFocus.current = false
        }
    }, [appFullscreen, pending])

    const enterWindowFullscreen = async () => {
        const alreadyFullscreen = await WindowIsFullscreen()
        if (!alreadyFullscreen) {
            WindowFullscreen()
            windowOwned.current = true
        }
    }

    const exitWindowFullscreen = () => {
        if (windowOwned.current) WindowUnfullscreen()
        windowOwned.current = false
    }

    const toggleAppFullscreen = async () => {
        if (busy.current) return
        busy.current = true
        setPending(true)
        setFullscreenError('')
        try {
            if (appFullscreen) {
                exitWindowFullscreen()
                setAppFullscreen(false)
                setSidebarVisible(true)
                notify('Exited application fullscreen')
            } else {
                await enterWindowFullscreen()
                setAppFullscreen(true)
                setSidebarVisible(false)
                notify('Entered application fullscreen')
            }
        } catch (error) {
            const message = `Could not change fullscreen mode: ${String(error)}`
            setFullscreenError(message)
            notify(message, 'error')
        } finally {
            busy.current = false
            setPending(false)
        }
    }

    const enterVnc = async (id: string) => {
        if (busy.current || vncSession) return
        busy.current = true
        setPending(true)
        setFullscreenError('')
        try {
            if (!appFullscreen) await enterWindowFullscreen()
            previousSidebar.current = sidebarVisible
            setSidebarVisible(false)
            setVncSession(id)
            notify('Entered VNC fullscreen')
        } finally {
            busy.current = false
            setPending(false)
        }
    }

    const exitVnc = () => {
        if (!vncSession) return
        if (!appFullscreen) exitWindowFullscreen()
        setFullscreenError('')
        setVncSession(null)
        setSidebarVisible(previousSidebar.current)
        notify('Exited VNC fullscreen')
    }

    const selectPlugin = (id: string) => {
        if (vncSession && id !== activeId) {
            try {
                exitVnc()
            } catch (error) {
                const message = `Could not exit VNC fullscreen: ${String(error)}`
                setFullscreenError(message)
                notify(message, 'error')
                return
            }
        }
        setActiveId(id)
    }

    const header = (
        <header className="workspace-header">
            <div className="workspace-heading">
                {appFullscreen && <SidebarToggle/>}
                <div className="workspace-title">
                    <p className="eyebrow">Utility framework / module</p>
                    <h1>{activePlugin?.title ?? 'Workspace'}</h1>
                </div>
            </div>
            <div className="workspace-actions">
                <button ref={appFullscreenButton} type="button" className="secondary fullscreen-icon-button"
                        disabled={pending}
                        aria-label={appFullscreen ? 'Exit application fullscreen' : 'Enter application fullscreen'}
                        title={appFullscreen ? 'Exit application fullscreen' : 'Enter application fullscreen'}
                        onClick={event => {
                            restoreAppFocus.current = event.detail === 0
                            void toggleAppFullscreen()
                        }}>
                    <FullscreenIcon active={appFullscreen}/>
                </button>
                <div className="workspace-status">
                    <span className="status-dot" aria-hidden="true"/>
                    <span>Local workspace</span>
                </div>
            </div>
        </header>
    )

    return (
        <FullscreenContext.Provider value={{
            activeModuleId: activeId, appFullscreen, vncSession, sidebarVisible, pending, error: fullscreenError, enterVnc, exitVnc,
            toggleSidebar: () => setSidebarVisible(value => !value),
        }}>
        <div className={`app${vncSession ? ' app-vnc-fullscreen' : ''}`}>
            <aside id="module-sidebar" className="sidebar" hidden={!sidebarVisible}>
                <div className="brand">
                    <span className="logo" aria-hidden="true">◆</span>
                    <span className="brand-name">Utility</span>
                </div>

                <p className="sidebar-label">Available modules</p>
                <nav className="tabs" aria-label="Utility modules">
                    {plugins.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            className={`tab ${p.id === activeId ? 'active' : ''}`}
                            disabled={pending}
                            aria-pressed={p.id === activeId}
                            onClick={() => selectPlugin(p.id)}
                        >
                            <span className="tab-icon" aria-hidden="true">{p.icon}</span>
                            <span className="tab-title">{p.title}</span>
                        </button>
                    ))}
                </nav>

            </aside>

            <main className="content">
                {appFullscreen && !vncSession
                    ? <FullscreenBar label="application controls">{header}</FullscreenBar>
                    : header}
                {fullscreenError && <p className="fullscreen-error" role="alert">{fullscreenError}</p>}
                <section className="plugin-content" aria-label={`${activePlugin?.title ?? 'Utility'} workspace`}>
                    {/* Keep plugins mounted so live terminal state survives module switches. */}
                    {plugins.map(p => (
                        <div key={p.id} className="plugin-pane" hidden={p.id !== activeId}>
                            <p.component/>
                        </div>
                    ))}
                </section>
            </main>
        </div>
        </FullscreenContext.Provider>
    )
}

export default App
