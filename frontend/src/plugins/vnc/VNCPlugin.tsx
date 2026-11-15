import {useEffect, useRef, useState} from 'react'
import RFB from '@novnc/novnc'
import {Start, Stop} from '../../../wailsjs/go/vnc/Service'
import {WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen} from '../../../wailsjs/runtime/runtime'
import ScreenshotEditor from './ScreenshotEditor'
import VNCConnections from './VNCConnections'
import type {Snapshot} from './ScreenshotEditor'
import './vnc.css'

interface Session {
    id: string
    host: string
    port: number
    password: string
}

function Desktop({session, active, onAuthLimit}: {session: Session; active: boolean; onAuthLimit: () => void}) {
    const desktop = useRef<HTMLDivElement>(null)
    const screen = useRef<HTMLDivElement>(null)
    const fullscreenButton = useRef<HTMLButtonElement>(null)
    const client = useRef<RFB | null>(null)
    const [status, setStatus] = useState('Connecting...')
    const [retryable, setRetryable] = useState(false)
    const [passwordPrompt, setPasswordPrompt] = useState(false)
    const [passwordInput, setPasswordInput] = useState('')
    const [attempt, setAttempt] = useState(0)
    const failures = useRef(0)
    const lastPassword = useRef(session.password)
    const awaitingPassword = useRef(false)
    const passwordSent = useRef(false)
    const [fullscreen, setFullscreen] = useState(false)
    const [fullscreenError, setFullscreenError] = useState('')
    const [fullscreenPending, setFullscreenPending] = useState(false)
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
    const [screenshotError, setScreenshotError] = useState('')
    const restoreWindow = useRef(false)
    const mounted = useRef(true)
    const restoreButtonFocus = useRef(false)

    useEffect(() => {
        return () => {
            mounted.current = false
            if (restoreWindow.current) WindowUnfullscreen()
        }
    }, [])

    useEffect(() => {
        if (!fullscreen || !desktop.current) return
        const siblings: {element: HTMLElement; inert: boolean}[] = []
        for (let element: HTMLElement | null = desktop.current; element && element !== document.body; element = element.parentElement) {
            for (const sibling of Array.from(element.parentElement?.children ?? [])) {
                if (sibling instanceof HTMLElement && sibling !== element) {
                    siblings.push({element: sibling, inert: sibling.inert})
                    sibling.inert = true
                }
            }
        }
        return () => {
            for (const sibling of siblings) sibling.element.inert = sibling.inert
        }
    }, [fullscreen])

    useEffect(() => {
        if (!fullscreenPending && restoreButtonFocus.current) {
            fullscreenButton.current?.focus()
            restoreButtonFocus.current = false
        }
    }, [fullscreenPending])

    const toggleFullscreen = async () => {
        setFullscreenError('')
        restoreButtonFocus.current = true
        setFullscreenPending(true)
        try {
            if (fullscreen) {
                if (restoreWindow.current) WindowUnfullscreen()
                restoreWindow.current = false
                setFullscreen(false)
            } else {
                const alreadyFullscreen = await WindowIsFullscreen()
                if (!mounted.current) return
                if (!alreadyFullscreen) WindowFullscreen()
                restoreWindow.current = !alreadyFullscreen
                setFullscreen(true)
            }
        } catch (error) {
            if (mounted.current) setFullscreenError(`Could not change fullscreen mode: ${String(error)}`)
        } finally {
            if (mounted.current) setFullscreenPending(false)
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
            setScreenshotError(`Could not capture screenshot: ${String(error)}`)
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
                failures.current = 0
                setStatus('Connected')
                setPasswordPrompt(false)
            })
            rfb.addEventListener('credentialsrequired', event => {
                if (disposed) return
                if (event.detail.types.some(type => type !== 'password')) {
                    failureHandled = true
                    setStatus('This server requires credentials other than a VNC password, which are not supported.')
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
                    setPasswordPrompt(true)
                } else {
                    setStatus(`Authentication failed${event.detail.reason ? `: ${event.detail.reason}` : '.'}`)
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
                }
            })
        }).catch(error => {
            if (!disposed) {
                setStatus(`Connection failed: ${String(error)}`)
                setRetryable(true)
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

    return (
        <div ref={desktop} className={`vnc-desktop ${fullscreen ? 'vnc-desktop-fullscreen' : ''}`}
             hidden={!active} role={fullscreen ? 'dialog' : undefined}
             aria-modal={fullscreen ? true : undefined}
             aria-label={fullscreen ? `Fullscreen VNC desktop ${session.host}` : undefined}>
            <div className="vnc-toolbar">
                <span role="status">{status}</span>
                <div className="vnc-toolbar-actions">
                    {retryable && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
                    <button type="button" className="secondary" disabled={status !== 'Connected'}
                            onClick={takeScreenshot}>Screenshot</button>
                    <button type="button" className="secondary" disabled={status !== 'Connected'}
                            onClick={() => client.current?.sendCtrlAltDel()}>Send Ctrl+Alt+Del</button>
                    <button ref={fullscreenButton} type="button" className="secondary vnc-fullscreen-button" disabled={fullscreenPending}
                            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            onClick={() => void toggleFullscreen()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                             aria-hidden="true">
                            {fullscreen
                                ? <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>
                                : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>}
                        </svg>
                    </button>
                </div>
            </div>
            {fullscreenError && <p className="vnc-fullscreen-error" role="alert">{fullscreenError}</p>}
            {screenshotError && <p className="vnc-fullscreen-error" role="alert">{screenshotError}</p>}
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
    const [sessions, setSessions] = useState<Session[]>([])
    const [active, setActive] = useState('new')
    const [message, setMessage] = useState('')

    const connect = (details: Omit<Session, 'id'>) => {
        const session = {id: crypto.randomUUID(), ...details}
        setSessions(current => [...current, session])
        setActive(session.id)
        setMessage('')
    }

    const close = (id: string) => {
        setSessions(current => current.filter(session => session.id !== id))
        setActive(current => current === id ? 'new' : current)
    }

    return (
        <div className="vnc">
            <div className="session-bar">
                {sessions.map(session => (
                    <div className="session-tab-group" key={session.id}>
                        <button type="button" className={`session-tab ${active === session.id ? 'active' : ''}`}
                                onClick={() => setActive(session.id)}>
                            {session.host}:{session.port}
                        </button>
                        <button type="button" className="session-close" aria-label={`Close ${session.host} session`}
                                onClick={() => close(session.id)}>×</button>
                    </div>
                ))}
                <button type="button" className={`session-add ${active === 'new' ? 'active' : ''}`}
                        aria-label="New VNC connection" onClick={() => setActive('new')}>+</button>
            </div>
            {message && <div className="vnc-session-message" role="alert">
                {message}
                <button type="button" className="secondary" onClick={() => setMessage('')}>Dismiss</button>
            </div>}
            <div className="vnc-body">
                {active === 'new' && <VNCConnections onConnect={connect}/>}
                {sessions.map(session => <Desktop key={session.id} session={session} active={active === session.id}
                    onAuthLimit={() => {
                        setMessage(`Session ${session.host}:${session.port} closed after three incorrect password attempts.`)
                        close(session.id)
                    }}/>)}
            </div>
        </div>
    )
}
