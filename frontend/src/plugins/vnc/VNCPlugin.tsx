import {useEffect, useRef, useState} from 'react'
import RFB from '@novnc/novnc'
import {Start, Stop} from '../../../wailsjs/go/vnc/Service'
import ScreenshotEditor from './ScreenshotEditor'
import VNCConnections from './VNCConnections'
import type {Snapshot} from './ScreenshotEditor'
import SessionTab from '../SessionTab'
import SessionBar from '../SessionBar'
import {useFullscreen} from '../../FullscreenContext'
import FullscreenBar from '../../FullscreenBar'
import {FullscreenIcon, SidebarToggle} from '../../FullscreenIcons'
import {useNotifications} from '../../NotificationContext'
import './vnc.css'

interface Session {
    id: string
    host: string
    port: number
    password: string
}

function Desktop({session, active, onAuthLimit, onAuthenticated}: {session: Session; active: boolean; onAuthLimit: () => void; onAuthenticated: (password: string) => void}) {
    const notify = useNotifications()
    const desktop = useRef<HTMLDivElement>(null)
    const screen = useRef<HTMLDivElement>(null)
    const fullscreenButton = useRef<HTMLButtonElement>(null)
    const restoreFullscreenFocus = useRef(false)
    const client = useRef<RFB | null>(null)
    const fullscreenControls = useFullscreen()
    const fullscreen = fullscreenControls.vncSession === session.id
    const [status, setStatus] = useState('Connecting...')
    const [retryable, setRetryable] = useState(false)
    const [passwordPrompt, setPasswordPrompt] = useState(false)
    const [passwordInput, setPasswordInput] = useState('')
    const [attempt, setAttempt] = useState(0)
    const failures = useRef(0)
    const lastPassword = useRef(session.password)
    const awaitingPassword = useRef(false)
    const passwordSent = useRef(false)
    const [fullscreenError, setFullscreenError] = useState('')
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
    const [screenshotError, setScreenshotError] = useState('')
    const [controlError, setControlError] = useState('')

    useEffect(() => {
        if (!fullscreenControls.pending && restoreFullscreenFocus.current) {
            fullscreenButton.current?.focus({preventScroll: true})
            restoreFullscreenFocus.current = false
        }
    }, [fullscreen, fullscreenControls.pending])

    useEffect(() => {
        if (!fullscreen || !desktop.current) return
        const siblings: {element: HTMLElement; inert: boolean}[] = []
        for (let element: HTMLElement | null = desktop.current; element && element !== document.body; element = element.parentElement) {
            for (const sibling of Array.from(element.parentElement?.children ?? [])) {
                if (sibling instanceof HTMLElement && sibling !== element && sibling.id !== 'module-sidebar' &&
                    sibling.dataset.fullscreenControls !== 'vnc' && !sibling.hasAttribute('data-notifications')) {
                    siblings.push({element: sibling, inert: sibling.inert})
                    sibling.inert = true
                }
            }
        }
        return () => {
            for (const sibling of siblings) sibling.element.inert = sibling.inert
        }
    }, [fullscreen])
    const toggleFullscreen = async () => {
        setFullscreenError('')
        try {
            if (fullscreen) fullscreenControls.exitVnc()
            else await fullscreenControls.enterVnc(session.id)
        } catch (error) {
            const message = `Could not change fullscreen mode: ${String(error)}`
            setFullscreenError(message)
            notify(message, 'error')
        }
    }

    const takeScreenshot = () => {
        setScreenshotError('')
        try {
            if (!client.current) throw new Error('VNC session is not connected')
            const image = client.current.getImageData()
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const context = canvas.getContext('2d')
            if (!context) throw new Error('Could not create screenshot canvas')
            context.putImageData(image, 0, 0)
            setSnapshot({data: canvas.toDataURL('image/png'), width: image.width, height: image.height})
        } catch (error) {
            const message = `Could not capture screenshot: ${String(error)}`
            setScreenshotError(message)
            notify(message, 'error')
        }
    }

    const sendCtrlAltDel = () => {
        setControlError('')
        try {
            if (!client.current) throw new Error('VNC session is not connected')
            client.current.sendCtrlAltDel()
            notify('Sent Ctrl+Alt+Del to VNC')
        } catch (error) {
            const message = `Could not send Ctrl+Alt+Del: ${String(error)}`
            setControlError(message)
            notify(message, 'error')
        }
    }

    useEffect(() => {
        let disposed = false
        let tunnelId = ''
        let rfb: RFB | null = null
        let failureHandled = false
        let disconnected = false

        setStatus('Connecting...')
        setRetryable(false)
        setPasswordPrompt(false)
        awaitingPassword.current = false
        passwordSent.current = false
        Start(session.host, session.port).then(tunnel => {
            tunnelId = tunnel.id
            if (disposed || !screen.current) {
                void Stop(tunnelId).catch(console.error)
                return
            }
            rfb = new RFB(screen.current, tunnel.url, {credentials: {}})
            client.current = rfb
            rfb.scaleViewport = true
            rfb.addEventListener('connect', () => {
                if (disposed) return
                onAuthenticated(lastPassword.current)
                failures.current = 0
                setStatus('Connected')
                setPasswordPrompt(false)
                notify(`VNC connected: ${session.host}:${session.port}`)
            })
            rfb.addEventListener('credentialsrequired', event => {
                if (disposed) return
                if (event.detail.types.some(type => type !== 'password')) {
                    failureHandled = true
                    setStatus('This server requires credentials other than a VNC password, which are not supported.')
                    notify(`VNC ${session.host}: unsupported authentication method`, 'error')
                    setRetryable(true)
                    rfb?.disconnect()
                } else if (lastPassword.current) {
                    passwordSent.current = true
                    rfb?.sendCredentials({password: lastPassword.current})
                } else {
                    awaitingPassword.current = true
                    setStatus('Enter the VNC password.')
                    setPasswordPrompt(true)
                }
            })
            rfb.addEventListener('serververification', () => {
                if (disposed) return
                failureHandled = true
                setStatus('This server requires identity verification, which is not supported.')
                notify(`VNC ${session.host}: identity verification is not supported`, 'error')
                setRetryable(true)
                rfb?.disconnect()
            })
            rfb.addEventListener('securityfailure', (event) => {
                if (disposed) return
                failureHandled = true
                awaitingPassword.current = false
                if (passwordSent.current) {
                    failures.current += 1
                    lastPassword.current = ''
                    if (failures.current >= 3) {
                        onAuthLimit()
                        return
                    }
                    setStatus(`Incorrect password. ${3 - failures.current} attempt(s) remaining.`)
                    notify(`VNC ${session.host}: incorrect password. ${3 - failures.current} attempt(s) remaining.`, 'error')
                    setPasswordPrompt(true)
                } else {
                    setStatus(`Authentication failed${event.detail.reason ? `: ${event.detail.reason}` : '.'}`)
                    notify(`VNC ${session.host}: authentication failed${event.detail.reason ? `: ${event.detail.reason}` : '.'}`, 'error')
                    setRetryable(true)
                }
            })
            rfb.addEventListener('disconnect', (event) => {
                disconnected = true
                if (!disposed && !failureHandled) {
                    awaitingPassword.current = false
                    setPasswordPrompt(false)
                    setRetryable(true)
                    setStatus(event.detail.clean
                        ? 'Disconnected.'
                        : 'Connection failed or was interrupted. Check the VNC server and local network permissions.')
                    notify(`VNC ${session.host}: ${event.detail.clean ? 'disconnected' : 'connection failed or was interrupted'}`,
                        event.detail.clean ? 'success' : 'error')
                }
            })
        }).catch(error => {
            if (!disposed) {
                setStatus(`Connection failed: ${String(error)}`)
                setRetryable(true)
                notify(`VNC ${session.host}: connection failed: ${String(error)}`, 'error')
            }
            if (tunnelId) void Stop(tunnelId).catch(console.error)
        })

        return () => {
            disposed = true
            client.current = null
            if (!disconnected) rfb?.disconnect()
            if (tunnelId) void Stop(tunnelId).catch(console.error)
        }
    }, [session.id, attempt])

    const toolbar = (
            <div className="vnc-toolbar">
                {fullscreen && <SidebarToggle/>}
                <span role="status">{status}</span>
                <div className="vnc-toolbar-actions">
                    {retryable && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
                    <button type="button" className="secondary" disabled={status !== 'Connected'}
                            onClick={takeScreenshot}>Screenshot</button>
                    <button type="button" className="secondary" disabled={status !== 'Connected'}
                            onClick={sendCtrlAltDel}>Send Ctrl+Alt+Del</button>
                    <button ref={fullscreenButton} type="button" className="secondary vnc-fullscreen-button" disabled={fullscreenControls.pending}
                            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            onClick={event => {
                                restoreFullscreenFocus.current = event.detail === 0
                                void toggleFullscreen()
                            }}>
                        <FullscreenIcon active={fullscreen}/>
                    </button>
                </div>
            </div>
    )

    return (
        <div ref={desktop} className={`vnc-desktop ${fullscreen ? 'vnc-desktop-fullscreen' : ''}`} hidden={!active}>
            {fullscreen ? <FullscreenBar label="VNC controls" portal>{toolbar}</FullscreenBar> : toolbar}
            {(fullscreenError || (fullscreen && fullscreenControls.error)) &&
                <p className="vnc-fullscreen-error" role="alert">{fullscreenError || fullscreenControls.error}</p>}
            {screenshotError && <p className="vnc-fullscreen-error" role="alert">{screenshotError}</p>}
            {controlError && <p className="vnc-fullscreen-error" role="alert">{controlError}</p>}
            {passwordPrompt && (
                <form className="vnc-password-prompt" onSubmit={event => {
                    event.preventDefault()
                    lastPassword.current = passwordInput
                    setPasswordInput('')
                    setPasswordPrompt(false)
                    setStatus('Connecting...')
                    if (awaitingPassword.current && client.current) {
                        awaitingPassword.current = false
                        passwordSent.current = true
                        client.current.sendCredentials({password: lastPassword.current})
                    } else {
                        setAttempt(value => value + 1)
                    }
                }}>
                    <label>
                        VNC password
                        <input name="password" type="password" autoComplete="current-password" required autoFocus
                               value={passwordInput} onChange={event => setPasswordInput(event.target.value)}/>
                    </label>
                    <button type="submit" className="primary">Try password</button>
                </form>
            )}
            <div className="vnc-screen" ref={screen} aria-label={`Remote desktop ${session.host}`}/>
            {snapshot && <ScreenshotEditor snapshot={snapshot} onClose={() => setSnapshot(null)}/>}
        </div>
    )
}

export default function VNCPlugin() {
    const notify = useNotifications()
    const [sessions, setSessions] = useState<Session[]>([])
    const [active, setActive] = useState('new')
    const [message, setMessage] = useState('')
    const fullscreenControls = useFullscreen()
    const pendingCloses = useRef(new Set<string>())
    const previousSelection = useRef<{module: string | undefined; appFullscreen: boolean; active: string} | null>(null)

    useEffect(() => {
        if (fullscreenControls.pending) return
        const current = {module: fullscreenControls.activeModuleId, appFullscreen: fullscreenControls.appFullscreen, active}
        const previous = previousSelection.current
        previousSelection.current = current
        const changed = !previous || previous.module !== current.module ||
            previous.appFullscreen !== current.appFullscreen || previous.active !== current.active
        if (!changed || current.module !== 'vnc' || !current.appFullscreen ||
            active === 'new' || fullscreenControls.vncSession) return
        void fullscreenControls.enterVnc(active).catch(error => {
            const message = `Could not enter VNC fullscreen: ${String(error)}`
            setMessage(message)
            notify(message, 'error')
        })
    }, [active, fullscreenControls.activeModuleId, fullscreenControls.appFullscreen, fullscreenControls.pending])

    const connect = (details: Omit<Session, 'id'>) => {
        if (fullscreenControls.pending) return
        const session = {id: crypto.randomUUID(), ...details}
        setSessions(current => [...current, session])
        setActive(session.id)
        setMessage('')
    }

    const close = (id: string) => {
        if (fullscreenControls.pending) {
            pendingCloses.current.add(id)
            return
        }
        if (fullscreenControls.vncSession === id) {
            try {
                fullscreenControls.exitVnc()
            } catch (error) {
                const message = `Could not exit VNC fullscreen: ${String(error)}`
                setMessage(message)
                notify(message, 'error')
                return
            }
        }
        setSessions(current => current.filter(session => session.id !== id))
        setActive(current => current === id ? 'new' : current)
    }

    useEffect(() => {
        if (fullscreenControls.pending || pendingCloses.current.size === 0) return
        const ids = Array.from(pendingCloses.current)
        pendingCloses.current.clear()
        ids.forEach(close)
    }, [fullscreenControls.pending, fullscreenControls.vncSession])

    return (
        <div className="vnc">
            <SessionBar sessionCount={sessions.length} activeKey={active}>
                {sessions.map(session => (
                    <SessionTab key={session.id} title={`${session.host}:${session.port}`} active={active === session.id}
                                closeLabel={`Close ${session.host} session`} onSelect={() => {
                                    if (!fullscreenControls.pending) setActive(session.id)
                                }}
                                onClose={() => close(session.id)} onDuplicate={() => connect({
                                    host: session.host, port: session.port, password: session.password,
                                })}/>
                ))}
                <button type="button" className={`session-add ${active === 'new' ? 'active' : ''}`}
                        disabled={fullscreenControls.pending}
                        aria-label="New VNC connection" onClick={() => setActive('new')}>+</button>
            </SessionBar>
            {message && <div className="vnc-session-message" role="alert">
                {message}
                <button type="button" className="secondary" onClick={() => setMessage('')}>Dismiss</button>
            </div>}
            <div className="vnc-body">
                {active === 'new' && <VNCConnections onConnect={connect}/>}
                {sessions.map(session => <Desktop key={session.id} session={session} active={active === session.id}
                    onAuthenticated={password => setSessions(current => current.map(item =>
                        item.id === session.id ? {...item, password} : item))}
                    onAuthLimit={() => {
                        const message = `Session ${session.host}:${session.port} closed after three incorrect password attempts.`
                        setMessage(message)
                        notify(message, 'error')
                        close(session.id)
                    }}/>)}
            </div>
        </div>
    )
}
