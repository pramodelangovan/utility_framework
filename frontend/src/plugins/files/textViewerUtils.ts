export interface TextMatch {
    start: number
    end: number
}

const wordCharacter = /[\p{L}\p{N}\p{M}_]/u

export function searchExpression(query: string, caseSensitive: boolean): RegExp {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, caseSensitive ? 'gu' : 'giu')
}

export function isWholeWordMatch(text: string, start: number, end: number): boolean {
    const previousUnit = text.charCodeAt(start - 1)
    const before = start === 0 ? '' : previousUnit >= 0xDC00 && previousUnit <= 0xDFFF && start >= 2
        ? text.slice(start - 2, start) : text.slice(start - 1, start)
    const after = String.fromCodePoint(text.codePointAt(end) ?? 0)
    return !wordCharacter.test(before) && !wordCharacter.test(after)
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
    let value = bytes
    let unit = -1
    do {
        value /= 1024
        unit++
    } while (value >= 1024 && unit < units.length - 1)
    let rounded = Number(value.toFixed(value < 10 ? 1 : 0))
    if (rounded >= 1024 && unit < units.length - 1) {
        rounded = 1
        unit++
    }
    return `${rounded} ${units[unit]}`
}

export function isVideoFile(name: string): boolean {
    return /\.(?:mp4|m4v|mov|mkv|webm|avi|mpg|mpeg|mpe|m2v|mpeg1|mpeg2|ts|m2ts|mts|wmv|flv|ogv|3gp|3g2|vob)$/i.test(name)
}

export function findMatches(text: string, query: string, caseSensitive: boolean, wholeWord: boolean): TextMatch[] {
    if (!query) return []
    const expression = searchExpression(query, caseSensitive)
    const matches: TextMatch[] = []
    for (const match of text.matchAll(expression)) {
        const start = match.index
        const end = start + match[0].length
        if (!wholeWord || isWholeWordMatch(text, start, end)) {
            matches.push({start, end})
        }
    }
    return matches
}

export function matchingFileNames(entries: {name: string}[], query: string): string[] {
    return entries.filter(entry => findMatches(entry.name, query, false, false).length > 0)
        .map(entry => entry.name)
}

export function includeSelectedMatch(matches: TextMatch[], selected: TextMatch | null): TextMatch[] {
    if (!selected || matches.some(match => match.start === selected.start && match.end === selected.end)) return matches
    return [...matches.filter(match => match.end <= selected.start || match.start >= selected.end), selected]
        .sort((a, b) => a.start - b.start)
}

export function languageForFile(name: string): string | undefined {
    const lower = name.toLowerCase()
    const base = lower.split('/').pop() ?? lower
    const extension = base.split('.').pop() ?? ''
    const languages: Record<string, string> = {
        js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
        ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby',
        sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml',
        h: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
        cs: 'csharp', rs: 'rust', md: 'markdown', kt: 'kotlin',
        ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'properties',
        html: 'xml', htm: 'xml', svg: 'xml',
    }
    if (base === 'dockerfile') return 'dockerfile'
    if (base === 'makefile') return 'makefile'
    return languages[extension] ?? extension
}

export function isLogFile(name: string): boolean {
    return /(?:^|\.)(?:log|logs)(?:\.\d+)*$/i.test(name)
}

export function imageMimeType(name: string): string | undefined {
    const base = name.toLowerCase().split('/').pop() ?? ''
    const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
    const types: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
        svg: 'image/svg+xml',
    }
    return Object.hasOwn(types, extension) ? types[extension] : undefined
}

export function fileIconType(name: string): {kind: 'code' | 'log' | 'text' | 'config' | 'file'; label: string} {
    const base = name.toLowerCase().split('/').pop() ?? ''
    if (isLogFile(base)) return {kind: 'log', label: 'LOG'}
    const extension = base.includes('.') && !base.endsWith('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
    if (['dockerfile', 'makefile'].includes(base)) return {kind: 'code', label: base === 'dockerfile' ? 'DOCKER' : 'MAKE'}
    if (['.env', '.gitignore', '.bashrc', '.profile'].includes(base)) return {kind: 'config', label: 'CONF'}
    if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'go', 'py', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
        'cs', 'java', 'kt', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'html', 'htm'].includes(extension)) {
        return {kind: 'code', label: extension.toUpperCase()}
    }
    if (['ini', 'cfg', 'conf', 'config', 'properties', 'toml', 'yaml', 'yml', 'json', 'xml'].includes(extension)) {
        return {kind: 'config', label: extension.length > 6 ? 'CONF' : extension.toUpperCase()}
    }
    if (['txt', 'text', 'md', 'rst'].includes(extension)) return {kind: 'text', label: extension.toUpperCase()}
    return {kind: 'file', label: /^[a-z0-9]{1,6}$/.test(extension) ? extension.toUpperCase() : 'FILE'}
}

export interface SearchResult {
    offset: number
    endOffset: number
    viewOffset: number
    line: number
    preview: string
}

interface SearchChunk {
    text: string
    offset: number
    nextOffset: number
    size: number
}

const encoder = new TextEncoder()
function runeBoundary(text: string, index: number): number {
    const unit = text.charCodeAt(index)
    return unit >= 0xDC00 && unit <= 0xDFFF ? index - 1 : index
}

async function yieldToBrowser() {
    const scheduler = (globalThis as typeof globalThis & {
        scheduler?: {yield?: () => Promise<void>}
    }).scheduler
    if (scheduler?.yield) await scheduler.yield()
    else await new Promise<void>(resolve => setTimeout(resolve, 0))
}

export async function searchFile(
    read: (offset: number) => Promise<SearchChunk>,
    query: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    expectedSize: number,
    skip: number,
    limit: number,
    signal: AbortSignal,
    onProgress: (offset: number) => void,
): Promise<{results: SearchResult[]; total: number}> {
    if (!query) throw new Error('Enter a search term.')
    const expression = searchExpression(query, caseSensitive)
    const results: SearchResult[] = []
    let total = 0
    let buffer = ''
    let cursor = 0
    let cursorByte = 0
    let line = 1
    let previousCR = false
    let next = 0
    let deadline = performance.now() + 50
    const advance = (end: number) => {
        const part = buffer.slice(cursor, end)
        cursorByte += encoder.encode(part).length
        for (let i = 0; i < part.length; i++) {
            const char = part.charCodeAt(i)
            if (char === 13 || (char === 10 && !previousCR)) line++
            previousCR = char === 13
        }
        cursor = end
    }

    do {
        signal.throwIfAborted()
        const chunk = await read(next)
        signal.throwIfAborted()
        if (chunk.offset !== next || chunk.size !== expectedSize ||
            chunk.nextOffset !== next + encoder.encode(chunk.text).length ||
            (chunk.nextOffset <= next && next < expectedSize) || chunk.nextOffset > expectedSize) {
            throw new Error('Remote file changed while searching; close and reopen it.')
        }
        buffer += chunk.text
        next = chunk.nextOffset
        const finished = next === expectedSize
        const cutoff = finished ? buffer.length : runeBoundary(buffer, Math.max(0, buffer.length - query.length - 200))
        while (cursor < buffer.length) {
            expression.lastIndex = cursor
            const match = expression.exec(buffer)
            if (!match || (!finished && match.index >= cutoff)) {
                advance(Math.max(cursor, cutoff))
                break
            }
            advance(match.index)
            const end = match.index + match[0].length
            if (!wholeWord || isWholeWordMatch(buffer, match.index, end)) {
                if (total >= skip && results.length < limit) {
                    const viewStart = runeBoundary(buffer, Math.max(0, match.index - 256))
                    const previousLine = Math.max(buffer.lastIndexOf('\n', match.index - 1),
                        buffer.lastIndexOf('\r', match.index - 1)) + 1
                    const newline = buffer.indexOf('\n', end)
                    const carriageReturn = buffer.indexOf('\r', end)
                    const nextLine = newline < 0 ? carriageReturn : carriageReturn < 0 ? newline : Math.min(newline, carriageReturn)
                    const previewStart = runeBoundary(buffer, Math.max(previousLine, match.index - 96))
                    const previewEnd = runeBoundary(buffer, Math.min(nextLine < 0 ? buffer.length : nextLine, end + 96))
                    results.push({
                        offset: cursorByte,
                        endOffset: cursorByte + encoder.encode(match[0]).length,
                        viewOffset: cursorByte - encoder.encode(buffer.slice(viewStart, match.index)).length,
                        line,
                        preview: `${previewStart > previousLine ? '…' : ''}${buffer.slice(previewStart, previewEnd).replace(/\r/g, '')}${nextLine < 0 ? (finished ? '' : '…') : previewEnd < nextLine ? '…' : ''}`,
                    })
                }
                total++
            }
            advance(end)
            if (performance.now() >= deadline) {
                await yieldToBrowser()
                signal.throwIfAborted()
                deadline = performance.now() + 50
            }
        }
        const discard = runeBoundary(buffer, Math.max(0, cursor - 256))
        buffer = buffer.slice(discard)
        cursor -= discard
        onProgress(next)
    } while (next < expectedSize)
    return {results, total}
}
