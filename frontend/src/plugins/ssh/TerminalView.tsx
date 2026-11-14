import {useEffect, useRef} from 'react'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {EventsOn} from '../../../wailsjs/runtime/runtime'
import {Connect, Disconnect, Resize, Write} from '../../../wailsjs/go/ssh/Service'
import type {ConnectionDetails} from './ConnectForm'

interface Props {
    id: string
    details: ConnectionDetails
    active: boolean
}

function decode(b64: string): Uint8Array {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

export default function TerminalView({id, details, active}: Props) {
    const host = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)

    useEffect(() => {
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Cascadia Mono, Consolas, monospace',
            fontSize: 14,
            theme: {background: '#07090e', foreground: '#f3fbff', cursor: '#00d4ff'},
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(host.current!)
        termRef.current = term

        const doFit = () => {
            if (host.current && host.current.clientWidth > 0) fit.fit()
        }
        doFit()

        term.write(`Connecting to ${details.username}@${details.host}:${details.port}...\r\n`)

        const offData = EventsOn('ssh:data:' + id, (b64: string) => term.write(decode(b64)))
        const offClosed = EventsOn('ssh:closed:' + id, () =>
            term.write('\r\n\x1b[33m[connection closed]\x1b[0m\r\n'))
        const input = term.onData(data => Write(id, data).catch(() => {}))
        const resize = term.onResize(({cols, rows}) => Resize(id, cols, rows).catch(() => {}))
        const observer = new ResizeObserver(doFit)
        observer.observe(host.current!)

        Connect(id, {
            host: details.host,
            port: details.port,
            username: details.username,
            authMethod: details.authMethod,
            password: details.password,
            privateKeyPath: details.privateKeyPath,
            passphrase: details.passphrase,
            savedId: details.savedId ?? '',
            startupCommand: details.startupCommand,
            cols: term.cols,
            rows: term.rows,
        }).catch(err => term.write(`\r\n\x1b[31mConnection failed: ${err}\x1b[0m\r\n`))

        return () => {
            observer.disconnect()
            input.dispose()
            resize.dispose()
            offData()
            offClosed()
            Disconnect(id)
            term.dispose()
        }
    }, [id])

    useEffect(() => {
        if (active) termRef.current?.focus()
    }, [active])

    return <div className="terminal-host" ref={host}/>
}
