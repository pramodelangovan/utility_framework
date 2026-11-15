import {useState} from 'react'
import type {ConnectionDetails} from './ConnectForm'
import NewConnection from './NewConnection'
import TerminalView from './TerminalView'
import useSSHLogins from './useSSHLogins'
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
    const {logins, error, setError, save, remove} = useSSHLogins()

    const open = (details: ConnectionDetails) => {
        const id = crypto.randomUUID()
        setSessions(s => [...s, {id, title: `${details.username}@${details.host}`, details}])
        setActiveKey(id)
    }

    const close = (id: string) => {
        setSessions(s => s.filter(x => x.id !== id))
        if (activeKey === id) setActiveKey(NEW)
    }

    return (
        <div className="ssh">
            <div className="session-bar">
                {sessions.map(s => (
                    <div key={s.id} className="session-tab-group">
                        <button type="button" className={`session-tab ${activeKey === s.id ? 'active' : ''}`}
                                title={s.title} onClick={() => setActiveKey(s.id)}>
                            {s.title}
                        </button>
                        <button type="button" className="session-close" title="Close session"
                                aria-label={`Close ${s.title} session`} onClick={() => {
                            close(s.id)
                        }}>×</button>
                    </div>
                ))}
                <button type="button" className={`session-add ${activeKey === NEW ? 'active' : ''}`} title="New connection"
                        aria-label="New connection"
                        onClick={() => setActiveKey(NEW)}>+
                </button>
            </div>

            <div className="ssh-body">
                {activeKey === NEW && (
                    <>
                        {error && (
                            <button type="button" className="ssh-error" onClick={() => setError('')}>
                                {error}
                            </button>
                        )}
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
