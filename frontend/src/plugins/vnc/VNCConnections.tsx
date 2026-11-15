import {useEffect, useState} from 'react'
import {DeleteLogin, GetLoginPassword, ListLogins, SaveLogin} from '../../../wailsjs/go/vnc/Service'
import type {vnc} from '../../../wailsjs/go/models'

interface Details {
    host: string
    port: number
    password: string
}

export default function VNCConnections({onConnect}: {onConnect: (details: Details) => void}) {
    const [logins, setLogins] = useState<vnc.Login[] | null>(null)
    const [editing, setEditing] = useState<vnc.Login | null>(null)
    const [host, setHost] = useState('')
    const [port, setPort] = useState('5900')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [remember, setRemember] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const refresh = async () => setLogins(await ListLogins())
    useEffect(() => {
        void refresh().catch(reason => setError(`Could not load VNC logins: ${String(reason)}`))
    }, [])

    const edit = (login: vnc.Login | null) => {
        setEditing(login)
        setHost(login?.host ?? '')
        setPort(String(login?.port ?? 5900))
        setPassword('')
        setName(login?.name ?? '')
        setRemember(login?.hasSecret ?? false)
        setError('')
    }

    const connect = async (login?: vnc.Login) => {
        setBusy(true)
        setError('')
        try {
            const useSaved = login ?? (editing && editing.host === host.trim() && editing.port === Number(port) ? editing : null)
            const secret = login ? '' : password
            const resolved = secret || (useSaved?.hasSecret ? await GetLoginPassword(useSaved.id) : '')
            onConnect({host: login?.host ?? host.trim(), port: login?.port ?? Number(port), password: resolved})
            setPassword('')
        } catch (reason) {
            setError(`Could not open VNC login: ${String(reason)}`)
        } finally {
            setBusy(false)
        }
    }

    const save = async () => {
        setBusy(true)
        setError('')
        try {
            const saved = await SaveLogin({
                id: editing?.id ?? '', name, host: host.trim(), port: Number(port), secret: password, saveSecret: remember,
            })
            await refresh()
            edit(saved)
        } catch (reason) {
            setError(`Could not save VNC login: ${String(reason)}`)
        } finally {
            setBusy(false)
        }
    }

    const remove = async (id: string) => {
        setBusy(true)
        setError('')
        try {
            await DeleteLogin(id)
            await refresh()
            if (editing?.id === id) edit(null)
        } catch (reason) {
            setError(`Could not delete VNC login: ${String(reason)}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="vnc-connections">
            {error && <p className="vnc-fullscreen-error" role="alert">{error}</p>}
            <div className="vnc-connection-columns">
                <section className="saved" aria-labelledby="vnc-saved-heading">
                    <div className="saved-head">
                        <h2 id="vnc-saved-heading">Saved logins</h2>
                        <button type="button" className="secondary" disabled={busy} onClick={() => edit(null)}>+ New</button>
                    </div>
                    {logins === null && !error && <p className="muted">Loading saved logins...</p>}
                    {logins?.length === 0 && <p className="muted">No saved logins yet.</p>}
                    {logins?.map(login => (
                        <div key={login.id} className="saved-item">
                            <button type="button" className="saved-info" disabled={busy}
                                    aria-label={`Connect to ${login.name}`} onClick={() => void connect(login)}>
                                <strong>{login.name}</strong><span>{login.host}:{login.port}</span>
                            </button>
                            <button type="button" disabled={busy} aria-label={`Edit ${login.name}`}
                                    onClick={() => edit(login)}>✎</button>
                            <button type="button" disabled={busy} aria-label={`Delete ${login.name}`}
                                    onClick={() => void remove(login.id)}>×</button>
                        </div>
                    ))}
                </section>
                <form className="vnc-form" aria-labelledby="vnc-heading" onSubmit={event => {
                    event.preventDefault()
                    void connect()
                }}>
                    <h2 id="vnc-heading">{editing ? 'Edit VNC login' : 'New VNC connection'}</h2>
                    <label>
                        Host (required)
                        <input name="host" required value={host} placeholder="192.168.1.10"
                               autoCapitalize="none" spellCheck={false} onChange={event => setHost(event.target.value)}/>
                    </label>
                    <label>
                        Port (required)
                        <input name="port" type="number" min="1" max="65535" required value={port}
                               onChange={event => setPort(event.target.value)}/>
                    </label>
                    <label>
                        VNC password (optional)
                        <input name="password" type="password" autoComplete="current-password" value={password}
                               placeholder={editing?.hasSecret ? '(saved - leave blank to keep)' : ''}
                               onChange={event => setPassword(event.target.value)}/>
                    </label>
                    <label>
                        Save as
                        <input name="login-name" value={name} placeholder={host ? `${host}:${port}` : 'Name'}
                               onChange={event => setName(event.target.value)}/>
                    </label>
                    <label className="vnc-remember">
                        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>
                        Remember password (OS credential store)
                    </label>
                    <button type="button" className="secondary" disabled={busy} onClick={event => {
                        if (event.currentTarget.form?.reportValidity()) void save()
                    }}>{editing ? 'Update saved login' : 'Save login'}</button>
                    <p>Standard VNC traffic is not encrypted. Use a trusted network, VPN, or secure tunnel.</p>
                    <button type="submit" className="primary" disabled={busy}>Connect</button>
                </form>
            </div>
        </div>
    )
}
