import {useEffect, useRef, useState} from 'react'
import RFB from '@novnc/novnc'
import {Start, Stop} from '../../../wailsjs/go/vnc/Service'
import {WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen} from '../../../wailsjs/runtime/runtime'
import ScreenshotEditor from './ScreenshotEditor'
import type {Snapshot} from './ScreenshotEditor'
import './vnc.css'

interface Session {
    id: string
    host: string
    port: number
    password: string
}

function Desktop({session, active}: {session: Session; active: boolean}) {
    const desktop = useRef<HTMLDivElement>(null)
    const screen = useRef<HTMLDivElement>(null)
    const fullscreenButton = useRef<HTMLButtonElement>(null)
    const client = useRef<RFB | null>(null)
    const [status, setStatus] = useState('Connecting...')
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
        let failure = ''

        Start(session.host, session.port).then(tunnel => {
            tunnelId = tunnel.id
            if (disposed || !screen.current) {
                void Stop(tunnelId).catch(console.error)
                return
            }
            rfb = new RFB(screen.current, tunnel.url, {
                credentials: session.password ? {password: session.password} : {},
            })
            client.current = rfb
            rfb.scaleViewport = true
            rfb.addEventListener('connect', () => setStatus('Connected'))
            rfb.addEventListener('credentialsrequired', event => {
                failure = event.detail.types.some(type => type !== 'password')
                    ? 'This server requires credentials other than a VNC password, which are not supported.'
                    : 'The server requires a VNC password. Close this session and reconnect with a password.'
                setStatus(failure)
                rfb?.disconnect()
            })
            rfb.addEventListener('serververification', () => {
                failure = 'This server requires identity verification, which is not supported.'
                setStatus(failure)
                rfb?.disconnect()
            })
            rfb.addEventListener('securityfailure', (event) => {
                failure = `Authentication failed${event.detail.reason ? `: ${event.detail.reason}` : '.'}`
                setStatus(failure)
            })
            rfb.addEventListener('disconnect', (event) => {
                if (!disposed) {
                    setStatus(failure || (event.detail.clean
                        ? 'Disconnected.'
                        : 'Connection failed or was interrupted. Check the VNC server and local network permissions.'))
                }
            })
        }).catch(error => {
            if (!disposed) setStatus(`Connection failed: ${String(error)}`)
            if (tunnelId) void Stop(tunnelId).catch(console.error)
        })

        return () => {
            disposed = true
            client.current = null
            rfb?.disconnect()
            if (tunnelId) void Stop(tunnelId).catch(console.error)
        }
    }, [session.id])

    return (
        <div ref={desktop} className={`vnc-desktop ${fullscreen ? 'vnc-desktop-fullscreen' : ''}`}
             hidden={!active} role={fullscreen ? 'dialog' : undefined}
             aria-modal={fullscreen ? true : undefined}
             aria-label={fullscreen ? `Fullscreen VNC desktop ${session.host}` : undefined}>
            <div className="vnc-toolbar">
                <span role="status">{status}</span>
                <div className="vnc-toolbar-actions">
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
            <div className="vnc-screen" ref={screen} aria-label={`Remote desktop ${session.host}`}/>
            {snapshot && <ScreenshotEditor snapshot={snapshot} onClose={() => setSnapshot(null)}/>}
        </div>
    )
}

export default function VNCPlugin() {
    const [host, setHost] = useState('')
    const [port, setPort] = useState('5900')
    const [password, setPassword] = useState('')
    const [sessions, setSessions] = useState<Session[]>([])
    const [active, setActive] = useState('new')

    const connect = () => {
        const session = {id: crypto.randomUUID(), host: host.trim(), port: Number(port), password}
        setSessions(current => [...current, session])
        setActive(session.id)
        setPassword('')
    }

    const close = (id: string) => {
        setSessions(current => current.filter(session => session.id !== id))
        if (active === id) setActive('new')
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
            <div className="vnc-body">
                {active === 'new' && (
                    <form className="vnc-form" aria-labelledby="vnc-heading" onSubmit={event => {
                        event.preventDefault()
                        connect()
                    }}>
                        <h2 id="vnc-heading">New VNC connection</h2>
                        <label>
                            Host (required)
                            <input name="host" required value={host} placeholder="192.168.1.10"
                                   autoCapitalize="none" spellCheck={false}
                                   onChange={event => setHost(event.target.value)}/>
                        </label>
                        <label>
                            Port (required)
                            <input name="port" type="number" min="1" max="65535" required value={port}
                                   onChange={event => setPort(event.target.value)}/>
                        </label>
                        <label>
                            VNC password (optional)
                            <input name="password" type="password" autoComplete="current-password" value={password}
                                   onChange={event => setPassword(event.target.value)}/>
                        </label>
                        <p>Standard VNC traffic is not encrypted. Use a trusted network, VPN, or secure tunnel.</p>
                        <button type="submit" className="primary">Connect</button>
                    </form>
                )}
                {sessions.map(session => <Desktop key={session.id} session={session} active={active === session.id}/>)}
            </div>
        </div>
    )
}
