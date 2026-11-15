import {useState} from 'react'

export interface ConnectionDetails {
    savedId?: string
    host: string
    port: number
    username: string
    authMethod: 'password' | 'key'
    password: string
    privateKeyPath: string
    passphrase: string
    startupCommand: string
}

export interface SaveOptions {
    name: string
    saveSecret: boolean
}

interface Props {
    initial?: Partial<ConnectionDetails> & { name?: string; hasSecret?: boolean }
    onConnect: (details: ConnectionDetails) => void
    onSave: (details: ConnectionDetails, opts: SaveOptions) => void
    files?: boolean
}

export const emptyDetails: ConnectionDetails = {
    host: '',
    port: 22,
    username: '',
    authMethod: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: '',
    startupCommand: '',
}

export default function ConnectForm({initial, onConnect, onSave, files = false}: Props) {
    const [d, setD] = useState<ConnectionDetails>({...emptyDetails, ...initial})
    const [name, setName] = useState(initial?.name ?? '')
    const [saveSecret, setSaveSecret] = useState(!!initial?.hasSecret)
    const set = <K extends keyof ConnectionDetails>(k: K, v: ConnectionDetails[K]) =>
        setD(prev => ({...prev, [k]: v}))
    const secretKey = d.authMethod === 'password' ? 'password' : 'passphrase'

    return (
        <form
            className="ssh-form"
            onSubmit={e => {
                e.preventDefault()
                const matchesSaved = initial && d.host === initial.host && d.port === initial.port &&
                    d.username === initial.username && d.authMethod === initial.authMethod &&
                    d.privateKeyPath === initial.privateKeyPath
                onConnect(files && !matchesSaved ? {...d, savedId: undefined} : d)
            }}
        >
            <h2>{d.savedId ? 'Edit login' : 'New SSH connection'}</h2>
            <div className="row">
                <label className="grow">
                    Host
                    <input required autoFocus value={d.host} placeholder="192.168.1.10"
                           onChange={e => set('host', e.target.value.trim())}/>
                </label>
                <label className="port">
                    Port
                    <input type="number" min={1} max={65535} value={d.port}
                           onChange={e => set('port', Number(e.target.value) || 22)}/>
                </label>
            </div>
            <label>
                Username
                <input required value={d.username} onChange={e => set('username', e.target.value)}/>
            </label>

            <div className="segmented">
                <button type="button" className={d.authMethod === 'password' ? 'on' : ''}
                        onClick={() => set('authMethod', 'password')}>Password
                </button>
                <button type="button" className={d.authMethod === 'key' ? 'on' : ''}
                        onClick={() => set('authMethod', 'key')}>Private key
                </button>
            </div>

            {d.authMethod === 'key' && (
                <label>
                    Private key file path
                    <input required value={d.privateKeyPath} placeholder="C:\Users\me\.ssh\id_ed25519"
                           onChange={e => set('privateKeyPath', e.target.value)}/>
                </label>
            )}
            <label>
                {d.authMethod === 'password' ? 'Password' : 'Passphrase (optional)'}
                <input type="password" value={d[secretKey]}
                       placeholder={initial?.hasSecret ? '(saved - leave blank to keep)' : ''}
                       onChange={e => set(secretKey, e.target.value)}/>
            </label>
            {!files && <label>
                Run command on connect (optional)
                <input value={d.startupCommand} placeholder="cd /var/log && ls"
                       onChange={e => set('startupCommand', e.target.value)}/>
            </label>}

            <div className="save-box">
                <label>
                    Save as
                    <input value={name} placeholder={d.username && d.host ? `${d.username}@${d.host}` : 'Name'}
                           onChange={e => setName(e.target.value)}/>
                </label>
                <label className="check">
                    <input type="checkbox" checked={saveSecret} onChange={e => setSaveSecret(e.target.checked)}/>
                    Remember {d.authMethod === 'password' ? 'password' : 'passphrase'} (OS credential store)
                </label>
                <button type="button" className="secondary"
                        onClick={() => d.host && d.username && onSave(d, {name, saveSecret})}>
                    {d.savedId ? 'Update saved login' : 'Save login'}
                </button>
            </div>

            <button type="submit" className="primary">Connect</button>
        </form>
    )
}
