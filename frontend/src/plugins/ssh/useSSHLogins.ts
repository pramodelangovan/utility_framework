import {useEffect, useState} from 'react'
import {DeleteLogin, ListLogins, SaveLogin} from '../../../wailsjs/go/ssh/Service'
import type {ssh} from '../../../wailsjs/go/models'
import type {ConnectionDetails, SaveOptions} from './ConnectForm'
import {useNotifications} from '../../NotificationContext'

const changed = 'ssh-logins-changed'

export default function useSSHLogins() {
    const notify = useNotifications()
    const [logins, setLogins] = useState<ssh.Login[]>([])
    const [error, setError] = useState('')

    useEffect(() => {
        let version = 0
        let disposed = false
        const refresh = () => {
            const current = ++version
            void ListLogins().then(result => {
                if (!disposed && current === version) setLogins(result)
            }).catch(reason => {
                if (!disposed && current === version) setError(String(reason))
            })
        }
        refresh()
        window.addEventListener(changed, refresh)
        return () => {
            disposed = true
            window.removeEventListener(changed, refresh)
        }
    }, [])

    const save = async (d: ConnectionDetails, opts: SaveOptions) => {
        setError('')
        try {
            const saved = await SaveLogin({
                id: d.savedId ?? '', name: opts.name, host: d.host, port: d.port,
                username: d.username, authMethod: d.authMethod, privateKeyPath: d.privateKeyPath,
                startupCommand: d.startupCommand, hasSecret: false,
                secret: d.authMethod === 'password' ? d.password : d.passphrase, saveSecret: opts.saveSecret,
            })
            window.dispatchEvent(new Event(changed))
            notify(`Saved SSH login ${saved.name}`)
            return saved
        } catch (reason) {
            setError(String(reason))
            notify(`Could not save SSH login: ${String(reason)}`, 'error')
            return undefined
        }
    }

    const remove = async (id: string) => {
        setError('')
        try {
            await DeleteLogin(id)
            window.dispatchEvent(new Event(changed))
            notify('Deleted SSH login')
        } catch (reason) {
            setError(String(reason))
            notify(`Could not delete SSH login: ${String(reason)}`, 'error')
        }
    }

    return {logins, error, setError, save, remove}
}
