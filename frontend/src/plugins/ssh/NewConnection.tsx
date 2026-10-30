import {useState} from 'react'
import ConnectForm, {ConnectionDetails, emptyDetails, SaveOptions} from './ConnectForm'
import {parseQuick} from './quick'
import type {ssh} from '../../../wailsjs/go/models'

interface Props {
    logins: ssh.Login[]
    onConnect: (details: ConnectionDetails) => void
    onSave: (details: ConnectionDetails, opts: SaveOptions) => Promise<ssh.Login | undefined>
    onDelete: (id: string) => void
}

function toDetails(l: ssh.Login): ConnectionDetails {
    return {
        ...emptyDetails,
        savedId: l.id,
        host: l.host,
        port: l.port,
        username: l.username,
        authMethod: (l.authMethod as 'password' | 'key') || 'password',
        privateKeyPath: l.privateKeyPath,
        startupCommand: l.startupCommand,
    }
}

export default function NewConnection({logins, onConnect, onSave, onDelete}: Props) {
    const [quick, setQuick] = useState('')
    const [form, setForm] = useState<{ key: number; initial?: any } | null>(null)

    const runQuick = () => {
        const {details, valid} = parseQuick(quick)
        if (!valid) return
        const match = logins.find(l =>
            l.host === details.host && l.username === details.username && l.port === (details.port ?? 22))
        if (match) {
            // Known login: reuse its stored credentials, but honour a command typed here.
            const d = toDetails(match)
            onConnect({...d, startupCommand: details.startupCommand ?? d.startupCommand})
            setQuick('')
        } else if (details.authMethod === 'key') {
            onConnect({...emptyDetails, ...details} as ConnectionDetails)
            setQuick('')
        } else {
            // No credentials known: prefill the form so a password can be entered.
            setForm({key: Date.now(), initial: details})
        }
    }

    const openForm = (initial?: any) => setForm({key: Date.now(), initial})

    return (
        <div className="new-conn">
            <div className="quick">
                <input
                    value={quick}
                    placeholder="Quick connect:  user@host[:port] [command]   or   ssh -p 22 -i key user@host"
                    onChange={e => setQuick(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runQuick()}
                />
                <button className="primary" onClick={runQuick}>Go</button>
            </div>

            <div className="new-conn-cols">
                <section className="saved">
                    <div className="saved-head">
                        <h3>Saved logins</h3>
                        <button className="secondary" onClick={() => openForm()}>+ New</button>
                    </div>
                    {logins.length === 0 && <p className="muted">No saved logins yet.</p>}
                    {logins.map(l => (
                        <div key={l.id} className="saved-item" onDoubleClick={() => onConnect(toDetails(l))}>
                            <div className="saved-info" onClick={() => onConnect(toDetails(l))}>
                                <strong>{l.name}</strong>
                                <span>{l.username}@{l.host}:{l.port}{l.startupCommand ? ` · ${l.startupCommand}` : ''}</span>
                            </div>
                            <button title="Edit" onClick={() => openForm({...toDetails(l), name: l.name, hasSecret: l.hasSecret})}>✎</button>
                            <button title="Delete" onClick={() => onDelete(l.id)}>🗑</button>
                        </div>
                    ))}
                </section>

                {form && (
                    <ConnectForm
                        key={form.key}
                        initial={form.initial}
                        onConnect={onConnect}
                        onSave={async (d, opts) => {
                            const saved = await onSave(d, opts)
                            if (saved) setForm({key: Date.now(), initial: {...d, savedId: saved.id, name: saved.name, hasSecret: saved.hasSecret, password: '', passphrase: ''}})
                        }}
                    />
                )}
            </div>
        </div>
    )
}
