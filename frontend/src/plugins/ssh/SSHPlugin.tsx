import {useEffect, useState} from 'react'
import {ConnectionDetails, SaveOptions} from './ConnectForm'
import NewConnection from './NewConnection'
import TerminalView from './TerminalView'
import {DeleteLogin, ListLogins, SaveLogin} from '../../../wailsjs/go/ssh/Service'
import type {ssh} from '../../../wailsjs/go/models'
import './ssh.css'

interface Session {
    id: string
    title: string
    details: ConnectionDetails
}

const NEW = 'new'

export default function SSHPlugin() {
    const [sessions, setSessions] = useState<Session[]>([])
    const [activeKey, setActiveKey] = useState<string>(NEW)
    const [logins, setLogins] = useState<ssh.Login[]>([])
    const [error, setError] = useState('')

    const refresh = () => ListLogins().then(l => setLogins(l ?? [])).catch(e => setError(String(e)))
    useEffect(() => {
        refresh()
    }, [])

    const open = (details: ConnectionDetails) => {
        const id = crypto.randomUUID()
        setSessions(s => [...s, {id, title: `${details.username}@${details.host}`, details}])
        setActiveKey(id)
    }

    const close = (id: string) => {
        setSessions(s => s.filter(x => x.id !== id))
        if (activeKey === id) setActiveKey(NEW)
    }

    const save = async (d: ConnectionDetails, opts: SaveOptions) => {
        setError('')
        try {
            const saved = await SaveLogin({
                id: d.savedId ?? '',
                name: opts.name,
                host: d.host,
                port: d.port,
                username: d.username,
                authMethod: d.authMethod,
                privateKeyPath: d.privateKeyPath,
                startupCommand: d.startupCommand,
                hasSecret: false,
                secret: d.authMethod === 'password' ? d.password : d.passphrase,
                saveSecret: opts.saveSecret,
            } as any)
            await refresh()
            return saved
        } catch (e) {
            setError(String(e))
            return undefined
        }
    }

    const remove = async (id: string) => {
        await DeleteLogin(id).catch(e => setError(String(e)))
        refresh()
    }

    return (
        <div className="ssh">
            <div className="session-bar">
                {sessions.map(s => (
                    <div key={s.id} className={`session-tab ${activeKey === s.id ? 'active' : ''}`}
                         onClick={() => setActiveKey(s.id)}>
                        <span>{s.title}</span>
                        <button title="Close session" onClick={e => {
                            e.stopPropagation()
                            close(s.id)
                        }}>×
                        </button>
                    </div>
                ))}
                <button className={`session-add ${activeKey === NEW ? 'active' : ''}`} title="New connection"
                        onClick={() => setActiveKey(NEW)}>+
                </button>
            </div>

            <div className="ssh-body">
                {activeKey === NEW && (
                    <>
                        {error && <div className="ssh-error" onClick={() => setError('')}>{error}</div>}
                        <NewConnection logins={logins} onConnect={open} onSave={save} onDelete={remove}/>
                    </>
                )}
                {sessions.map(s => (
                    <div key={s.id} className="terminal-pane" style={{display: activeKey === s.id ? 'block' : 'none'}}>
                        <TerminalView id={s.id} details={s.details} active={activeKey === s.id}/>
                    </div>
                ))}
            </div>
        </div>
    )
}
