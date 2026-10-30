import type {ConnectionDetails} from './ConnectForm'

export interface QuickParse {
    details: Partial<ConnectionDetails>
    valid: boolean
}

// Parses "ssh -p 2222 -i key user@host[:port] [command...]" or "user@host[:port] [command...]".
// Anything after the host token is run in the shell once connected.
export function parseQuick(input: string): QuickParse {
    const tokens = input.trim().split(/\s+/).filter(Boolean)
    if (tokens[0] === 'ssh') tokens.shift()

    const d: Partial<ConnectionDetails> = {}
    let i = 0
    for (; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === '-p' && tokens[i + 1]) d.port = Number(tokens[++i]) || 22
        else if (t === '-i' && tokens[i + 1]) {
            d.authMethod = 'key'
            d.privateKeyPath = tokens[++i]
        } else if (t === '-l' && tokens[i + 1]) d.username = tokens[++i]
        else if (!t.startsWith('-')) break
    }
    const target = tokens[i]
    if (!target) return {details: d, valid: false}

    let hostPart = target
    const at = target.lastIndexOf('@')
    if (at >= 0) {
        d.username = target.slice(0, at)
        hostPart = target.slice(at + 1)
    }
    const colon = hostPart.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(hostPart.slice(colon + 1))) {
        d.port = Number(hostPart.slice(colon + 1))
        hostPart = hostPart.slice(0, colon)
    }
    d.host = hostPart
    const command = tokens.slice(i + 1).join(' ')
    if (command) d.startupCommand = command
    return {details: d, valid: !!d.host && !!d.username}
}
