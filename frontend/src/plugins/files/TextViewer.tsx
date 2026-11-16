import {useEffect, useId, useMemo, useRef, useState} from 'react'
import hljs from 'highlight.js'
import {ReadTextChunk} from '../../../wailsjs/go/ssh/Service'
import {findMatches, formatSize, includeSelectedMatch, isLogFile, isWholeWordMatch, languageForFile, searchFile} from './textViewerUtils'
import type {SearchResult, TextMatch} from './textViewerUtils'
import {useNotifications} from '../../NotificationContext'

interface Decoration extends TextMatch {
    kind: 'search' | 'tag' | 'error' | 'warning' | 'info'
    index?: number
}

interface Token {
    text: string
    className: string
}

const resultsPageSize = 200

function syntaxTokens(text: string, name: string): Token[] {
    const language = languageForFile(name)
    if (isLogFile(name) || !language || !hljs.getLanguage(language)) return [{text, className: ''}]
    const html = hljs.highlight(text, {language, ignoreIllegals: true}).value
    const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
    const tokens: Token[] = []
    const visit = (node: Node, className: string) => {
        if (node.nodeType === Node.TEXT_NODE) {
            tokens.push({text: node.textContent ?? '', className})
        } else if (node instanceof Element) {
            const classes = [className, node.className].filter(Boolean).join(' ')
            node.childNodes.forEach(child => visit(child, classes))
        }
    }
    root.childNodes.forEach(node => visit(node, ''))
    return tokens
}

function decoratedTokens(tokens: Token[], decorations: Decoration[], current: number) {
    const events = decorations.flatMap((decoration, id) => [
        {position: decoration.start, start: true, id},
        {position: decoration.end, start: false, id},
    ]).sort((a, b) => a.position - b.position)
    const active = new Set<number>()
    const priority = {search: 3, tag: 2, error: 1, warning: 1, info: 1}
    const result = []
    let position = 0
    let eventIndex = 0
    let key = 0
    for (const token of tokens) {
        const end = position + token.text.length
        while (position < end) {
            while (eventIndex < events.length && events[eventIndex].position <= position) {
                const event = events[eventIndex++]
                if (event.start) active.add(event.id)
                else active.delete(event.id)
            }
            const next = Math.min(end, events[eventIndex]?.position ?? end)
            const selected = [...active].map(id => decorations[id])
                .sort((a, b) => priority[b.kind] - priority[a.kind])[0]
            const content = token.text.slice(position - (end - token.text.length), next - (end - token.text.length))
            const className = [token.className, selected && `file-highlight-${selected.kind}`,
                selected?.kind === 'search' && selected.index === current && 'file-highlight-current']
                .filter(Boolean).join(' ')
            if (selected?.kind === 'search' || selected?.kind === 'tag') {
                result.push(<mark key={key++} className={className}
                                  data-match={selected.kind === 'search' ? selected.index : undefined}>{content}</mark>)
            } else {
                result.push(<span key={key++} className={className || undefined}>{content}</span>)
            }
            position = next
        }
    }
    return result
}

export default function TextViewer({sessionId, path, onClose}: {sessionId: string; path: string; onClose: () => void}) {
    const notify = useNotifications()
    const [text, setText] = useState('')
    const [startOffset, setStartOffset] = useState(0)
    const [offset, setOffset] = useState(0)
    const [size, setSize] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [caseSensitive, setCaseSensitive] = useState(false)
    const [wholeWord, setWholeWord] = useState(false)
    const [wrapSearch, setWrapSearch] = useState(true)
    const [wordWrap, setWordWrap] = useState(false)
    const [tagInput, setTagInput] = useState('')
    const [tags, setTags] = useState<string[]>([])
    const [current, setCurrent] = useState(0)
    const [selectedMatch, setSelectedMatch] = useState<TextMatch | null>(null)
    const [showFind, setShowFind] = useState(false)
    const [showHighlights, setShowHighlights] = useState(false)
    const [showResults, setShowResults] = useState(false)
    const [searching, setSearching] = useState(false)
    const [searchProgress, setSearchProgress] = useState(0)
    const [searchStatus, setSearchStatus] = useState('')
    const [searchResults, setSearchResults] = useState<{results: SearchResult[]; total: number; skip: number} | null>(null)
    const alive = useRef(true)
    const searchController = useRef<AbortController | null>(null)
    const selectionVersion = useRef(0)
    const content = useRef<HTMLPreElement>(null)
    const searchInput = useRef<HTMLInputElement>(null)
    const dialog = useRef<HTMLDialogElement>(null)
    const id = useId()

    useEffect(() => {
        alive.current = true
        dialog.current?.showModal()
        return () => {
            alive.current = false
            searchController.current?.abort()
        }
    }, [])

    const load = async (all = false) => {
        setLoading(true)
        setError('')
        let next = offset
        let expected = size
        try {
            do {
                const chunk = await ReadTextChunk(sessionId, path, next)
                if (!alive.current) return
                if (chunk.offset !== next || (expected !== null && chunk.size !== expected) ||
                    (chunk.nextOffset <= next && next < chunk.size)) {
                    throw new Error('Remote file changed while reading; close and reopen it.')
                }
                expected = chunk.size
                next = chunk.nextOffset
                setText(previous => previous + chunk.text)
                setOffset(next)
                setSize(expected)
            } while (all && alive.current && next < expected)
        } catch (reason) {
            if (alive.current) {
                const message = `Could not read file: ${String(reason)}`
                setError(message)
                notify(message, 'error')
            }
        } finally {
            if (alive.current) setLoading(false)
        }
    }

    useEffect(() => { void load() }, [])

    useEffect(() => {
        if (showFind) searchInput.current?.focus()
    }, [showFind])

    const resetFileSearch = () => {
        selectionVersion.current++
        setSelectedMatch(null)
        searchController.current?.abort()
        searchController.current = null
        setSearching(false)
        setSearchResults(null)
        setSearchStatus('')
        setShowResults(false)
    }

    const runFileSearch = async (skip = 0) => {
        if (!query || size === null) return
        searchController.current?.abort()
        const controller = new AbortController()
        searchController.current = controller
        setShowResults(true)
        setSearching(true)
        setSearchResults(null)
        setSearchStatus('')
        setSearchProgress(0)
        let lastUpdate = 0
        try {
            const result = await searchFile(
                position => ReadTextChunk(sessionId, path, position),
                query, caseSensitive, wholeWord, size, skip, resultsPageSize, controller.signal,
                position => {
                    if (performance.now() - lastUpdate >= 150 || position === size) {
                        setSearchProgress(position)
                        lastUpdate = performance.now()
                    }
                },
            )
            if (searchController.current !== controller || !alive.current) return
            if (skip > 0 && skip >= result.total) {
                throw new Error('Search results changed; search the file again.')
            }
            setSearchResults({...result, skip})
            setSearchStatus(`${result.total.toLocaleString()} ${result.total === 1 ? 'match' : 'matches'} in the whole file`)
        } catch (reason) {
            if (searchController.current === controller && alive.current) {
                const message = `Search failed: ${String(reason)}`
                setSearchStatus(message)
                notify(message, 'error')
            }
        } finally {
            if (searchController.current === controller && alive.current) {
                searchController.current = null
                setSearching(false)
            }
        }
    }

    const cancelFileSearch = () => {
        searchController.current?.abort()
        searchController.current = null
        setSearching(false)
        setSearchStatus('Search cancelled.')
    }

    const openResult = async (result?: SearchResult) => {
        if (size === null || loading) return
        const version = selectionVersion.current
        setLoading(true)
        setError('')
        const start = result?.viewOffset ?? 0
        let next = start
        const parts: string[] = []
        try {
            do {
                const chunk = await ReadTextChunk(sessionId, path, next)
                if (!alive.current || selectionVersion.current !== version) return
                if (chunk.offset !== next || chunk.size !== size ||
                    (chunk.nextOffset <= next && next < size)) {
                    throw new Error('Remote file changed; close and reopen it.')
                }
                parts.push(chunk.text)
                next = chunk.nextOffset
            } while (result && next <= result.endOffset && next < size)
            const loaded = parts.join('')
            let selected = 0
            let target: TextMatch | null = null
            if (result) {
                const bytes = new TextEncoder().encode(loaded)
                const decoder = new TextDecoder('utf-8', {fatal: true})
                const prefix = decoder.decode(bytes.slice(0, result.offset - start)).replace(/\r\n?/g, '\n')
                const matchText = decoder.decode(bytes.slice(result.offset - start, result.endOffset - start)).replace(/\r\n?/g, '\n')
                const normalized = loaded.replace(/\r\n?/g, '\n')
                target = {start: prefix.length, end: prefix.length + matchText.length}
                const exact = findMatches(matchText, query, caseSensitive, false)
                if (exact.length !== 1 || exact[0].start !== 0 || exact[0].end !== matchText.length ||
                    (wholeWord && !isWholeWordMatch(normalized, target.start, target.end))) {
                    throw new Error('The selected match is no longer present; search again.')
                }
                selected = includeSelectedMatch(findMatches(normalized, query, caseSensitive, wholeWord), target)
                    .findIndex(match => match.start === target?.start)
            }
            setText(loaded)
            setStartOffset(start)
            setOffset(next)
            setSelectedMatch(target)
            setCurrent(selected)
        } catch (reason) {
            if (alive.current) {
                const message = `Could not open result: ${String(reason)}`
                setError(message)
                notify(message, 'error')
            }
        } finally {
            if (alive.current) setLoading(false)
        }
    }

    const displayText = useMemo(() => text.replace(/\r\n?/g, '\n'), [text])
    const matches = useMemo(() => includeSelectedMatch(findMatches(displayText, query, caseSensitive, wholeWord), selectedMatch),
        [displayText, query, caseSensitive, wholeWord, selectedMatch])
    const tokens = useMemo(() => syntaxTokens(displayText, path), [displayText, path])
    const decorations = useMemo(() => {
        const result: Decoration[] = matches.map((match, index) => ({...match, kind: 'search', index}))
        for (const tag of tags) {
            result.push(...findMatches(displayText, tag, false, false).map(match => ({...match, kind: 'tag' as const})))
        }
        if (isLogFile(path)) {
            const expression = /\b(?:fatal|critical|crit|error|err|exception|failed|failure|warn|warning|info|notice|debug|trace)\b/gi
            for (const match of displayText.matchAll(expression)) {
                const word = match[0].toLowerCase()
                const kind = /^(fatal|critical|crit|error|err|exception|failed|failure)$/.test(word)
                    ? 'error' : /^(warn|warning)$/.test(word) ? 'warning' : 'info'
                result.push({start: match.index, end: match.index + match[0].length, kind})
            }
        }
        return result
    }, [matches, tags, displayText, path])
    const rendered = useMemo(() => decoratedTokens(tokens, decorations, current), [tokens, decorations, current])

    useEffect(() => { setCurrent(0) }, [query, caseSensitive, wholeWord])
    useEffect(() => {
        if (matches.length) {
            content.current?.querySelector(`[data-match="${Math.min(current, matches.length - 1)}"]`)
                ?.scrollIntoView({block: 'nearest', inline: 'nearest'})
        }
    }, [current, matches])

    const navigate = (direction: number) => {
        if (!matches.length) return
        const next = current + direction
        const index = wrapSearch ? (next + matches.length) % matches.length
            : Math.max(0, Math.min(matches.length - 1, next))
        setCurrent(index)
    }

    return (
        <dialog ref={dialog} className="text-viewer-window" aria-labelledby={`${id}-title`} onClose={onClose}
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    dialog.current?.close()
                } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                    event.preventDefault()
                    setShowFind(true)
                    searchInput.current?.focus()
                    searchInput.current?.select()
                }
            }}>
        <section className="text-viewer">
            <div className="text-viewer-toolbar">
                <button type="button" className="secondary text-viewer-icon" aria-label="Back to files"
                        title="Back to files" onClick={() => dialog.current?.close()}>←</button>
                <h2 id={`${id}-title`} className="text-viewer-path" title={path}>{path.split('/').pop()}</h2>
                <button type="button" className="secondary" aria-expanded={showFind}
                        aria-controls={`${id}-find`} onClick={() => setShowFind(value => !value)}>Find</button>
                <button type="button" className="secondary" aria-expanded={showHighlights}
                        aria-controls={`${id}-highlights`} onClick={() => setShowHighlights(value => !value)}>Highlights</button>
                <button type="button" className="secondary text-viewer-icon" aria-label="Close file viewer"
                        title="Close file viewer" onClick={() => dialog.current?.close()}>×</button>
            </div>
            <div className="text-viewer-meta">
                <span>{size === null ? 'Opening...' : startOffset === 0
                    ? `${formatSize(offset)} of ${formatSize(size)} loaded`
                    : `Viewing ${formatSize(offset - startOffset)} at byte ${startOffset.toLocaleString()} of ${formatSize(size)}`}</span>
                {startOffset > 0 && <button type="button" className="secondary" disabled={loading}
                    onClick={() => void openResult()}>Back to start</button>}
                {size !== null && offset < size && <>
                    <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>Load more</button>
                    <button type="button" className="secondary" disabled={loading} onClick={() => void load(true)}>Load remaining</button>
                </>}
                {loading && <span>Loading...</span>}
            </div>
            {error && <p className="file-browser-error" role="alert">{error}</p>}
            <div id={`${id}-find`} className="text-viewer-options" hidden={!showFind}>
            <div className="text-viewer-controls">
                <label htmlFor={`${id}-search`}>Search loaded text</label>
                <input ref={searchInput} id={`${id}-search`} type="search" value={query} spellCheck={false}
                       onChange={event => { resetFileSearch(); setQuery(event.target.value) }}
                       onKeyDown={event => {
                           if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                               event.preventDefault()
                               navigate(event.shiftKey ? -1 : 1)
                           }
                       }}/>
                <button type="button" className="secondary" disabled={!matches.length} onClick={() => navigate(-1)}>Previous</button>
                <button type="button" className="secondary" disabled={!matches.length} onClick={() => navigate(1)}>Next</button>
                <span>{query ? `${matches.length ? Math.min(current + 1, matches.length) : 0} / ${matches.length} in view` : 'Enter a search term'}</span>
                <button type="button" className="secondary" disabled={!query || size === null}
                        aria-expanded={showResults} aria-controls={`${id}-results`}
                        onClick={() => {
                            if (showResults) {
                                if (searching) cancelFileSearch()
                                setShowResults(false)
                            } else if (searchResults) setShowResults(true)
                            else void runFileSearch()
                        }}>Search whole file</button>
                <label htmlFor={`${id}-case`}><input id={`${id}-case`} type="checkbox" checked={caseSensitive} onChange={event => { resetFileSearch(); setCaseSensitive(event.target.checked) }}/> Case sensitive</label>
                <label htmlFor={`${id}-whole`}><input id={`${id}-whole`} type="checkbox" checked={wholeWord} onChange={event => { resetFileSearch(); setWholeWord(event.target.checked) }}/> Whole words</label>
                <label htmlFor={`${id}-search-wrap`}><input id={`${id}-search-wrap`} type="checkbox" checked={wrapSearch} onChange={event => setWrapSearch(event.target.checked)}/> Wrap search</label>
                <label htmlFor={`${id}-word-wrap`}><input id={`${id}-word-wrap`} type="checkbox" checked={wordWrap} onChange={event => setWordWrap(event.target.checked)}/> Word wrap</label>
            </div>
            </div>
            <div id={`${id}-highlights`} className="text-viewer-options" hidden={!showHighlights}>
            <form className="text-viewer-controls" onSubmit={event => {
                event.preventDefault()
                const tag = tagInput.trim()
                if (tag && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
                    setTags(previous => [...previous, tag])
                }
                setTagInput('')
            }}>
                <label htmlFor={`${id}-tag`}>Highlight word or phrase</label>
                <input id={`${id}-tag`} value={tagInput} onChange={event => setTagInput(event.target.value)}/>
                <button type="submit" className="secondary">Add highlight</button>
                {tags.map(tag => <button type="button" className="secondary" key={tag}
                    aria-label={`Remove highlight ${tag}`} onClick={() => setTags(previous => previous.filter(item => item !== tag))}>{tag} ×</button>)}
            </form>
            </div>
            <pre ref={content} className={`text-viewer-content${wordWrap ? ' wrap' : ''}`} tabIndex={0}
                 aria-label="File contents"><code>{rendered}</code></pre>
            {showResults && <section id={`${id}-results`} className="text-search-results" aria-labelledby={`${id}-results-title`}>
                <div className="text-search-results-header">
                    <h3 id={`${id}-results-title`}>Whole-file search results</h3>
                    <span role="status">{searchStatus}</span>
                    {searching && <>
                        <progress aria-label="Searching file" value={searchProgress} max={Math.max(size ?? 0, 1)}/>
                        <span>{formatSize(searchProgress)} / {formatSize(size ?? 0)}</span>
                        <button type="button" className="secondary" onClick={cancelFileSearch}>Cancel search</button>
                    </>}
                    <button type="button" className="secondary text-viewer-icon" aria-label="Close search results"
                        onClick={() => { if (searching) cancelFileSearch(); setShowResults(false) }}>×</button>
                </div>
                {searchResults && <>
                    <div className="text-search-results-pages">
                        <button type="button" className="secondary" disabled={searchResults.skip === 0}
                            onClick={() => void runFileSearch(Math.max(0, searchResults.skip - resultsPageSize))}>Previous results</button>
                        <span>{searchResults.total ? `${searchResults.skip + 1}–${searchResults.skip + searchResults.results.length} of ${searchResults.total}` : 'No matches'}</span>
                        <button type="button" className="secondary"
                            disabled={searchResults.skip + searchResults.results.length >= searchResults.total}
                            onClick={() => void runFileSearch(searchResults.skip + resultsPageSize)}>Next results</button>
                    </div>
                    <ol className="text-search-results-list">
                        {searchResults.results.map(result => <li key={result.offset}>
                            <button type="button" disabled={loading} onClick={() => void openResult(result)}>
                                <span>Line {result.line.toLocaleString()}</span> {result.preview}
                            </button>
                        </li>)}
                    </ol>
                </>}
            </section>}
        </section>
        </dialog>
    )
}
