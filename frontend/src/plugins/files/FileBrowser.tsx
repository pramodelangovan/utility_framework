import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {KeyboardEvent, MouseEvent} from 'react'
import {createPortal} from 'react-dom'
import {ConnectBrowser, DisconnectBrowser, DownloadFile, ListDirectory, PlayVideo, UploadFile} from '../../../wailsjs/go/ssh/Service'
import type {ssh} from '../../../wailsjs/go/models'
import {BrowserOpenURL} from '../../../wailsjs/runtime/runtime'
import type {ConnectionDetails} from '../ssh/ConnectForm'
import NewConnection from '../ssh/NewConnection'
import useSSHLogins from '../ssh/useSSHLogins'
import TextViewer from './TextViewer'
import ImageViewer from './ImageViewer'
import HtmlViewer from './HtmlViewer'
import {fileIconType, formatSize, imageMimeType, isVideoFile, matchingFileNames} from './textViewerUtils'
import {visibleFileEntries} from './fileBrowserUtils'
import type {FileSort, SortDirection} from './fileBrowserUtils'
import './files.css'

interface Session {
    id: string
    details: ConnectionDetails
}

interface FileContextMenu {
    name: string
    isDir: boolean
    x: number
    y: number
    keyboard: boolean
    previousFocus: HTMLElement | null
}

function remoteChild(parent: string, name: string) {
    return `${parent === '/' ? '' : parent}/${name}`
}

function parentDirectory(dir: string) {
    return dir === '/' ? '/' : dir.slice(0, dir.lastIndexOf('/')) || '/'
}

function FileIcon({name, folder}: {name: string; folder: boolean}) {
    const type = fileIconType(name)
    return <span className={`file-icon ${folder ? 'folder' : type.kind}`} aria-hidden="true">
        <svg viewBox="0 0 48 48">
            {folder
                ? <path d="M4 13a3 3 0 0 1 3-3h12l4 4h18a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/>
                : <path d="M8 4h21l10 10v29H8z M29 4v11h10"/>}
            {!folder && type.kind === 'code' && <path d="m19 21-4 4 4 4m9-8 4 4-4 4m-3-11-3 14"/>}
            {!folder && type.kind !== 'code' && <path d="M14 21h19M14 26h19M14 31h13"/>}
        </svg>
        {!folder && <span className="file-icon-label">{type.label}</span>}
    </span>
}

function VLCMissingDialog({onClose, onDownload}: {onClose: () => void; onDownload: () => void}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const title = useId()
    useEffect(() => { dialog.current?.showModal() }, [])

    return <dialog ref={dialog} className="file-vlc-dialog" aria-labelledby={title} onClose={onClose}>
        <h2 id={title}>VLC player not found</h2>
        <p>Install VLC to stream this video, or download the video to play it another way.</p>
        <div className="file-vlc-actions">
            <button type="button" className="secondary" onClick={() => {
                BrowserOpenURL('https://www.videolan.org/vlc/')
                dialog.current?.close()
            }}>Download VLC</button>
            <button type="button" className="secondary" onClick={() => {
                dialog.current?.close()
                onDownload()
            }}>Download video</button>
            <button type="button" className="secondary" autoFocus onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
    </dialog>
}

function BrowserPane({session, active}: {session: Session; active: boolean}) {
    const [directory, setDirectory] = useState<ssh.Directory | null>(null)
    const [input, setInput] = useState('')
    const [error, setError] = useState('')
    const [status, setStatus] = useState('Connecting...')
    const [busy, setBusy] = useState(true)
    const [attempt, setAttempt] = useState(0)
    const [view, setView] = useState<'list' | 'grid'>('list')
    const [showHidden, setShowHidden] = useState(false)
    const [sortBy, setSortBy] = useState<FileSort>('name')
    const [sortDirection, setSortDirection] = useState<SortDirection>('ascending')
    const [sortStatus, setSortStatus] = useState('')
    const [showFind, setShowFind] = useState(false)
    const [query, setQuery] = useState('')
    const [currentMatch, setCurrentMatch] = useState(0)
    const [findAnnouncement, setFindAnnouncement] = useState('')
    const [viewedFile, setViewedFile] = useState<string | null>(null)
    const [htmlSource, setHtmlSource] = useState(false)
    const [missingVLCVideo, setMissingVLCVideo] = useState<string | null>(null)
    const [contextMenu, setContextMenu] = useState<FileContextMenu | null>(null)
    const mounted = useRef(true)
    const paneRef = useRef<HTMLDivElement>(null)
    const tableRef = useRef<HTMLDivElement>(null)
    const findInputRef = useRef<HTMLInputElement>(null)
    const findButtonRef = useRef<HTMLButtonElement>(null)
    const findId = useId()
    const menuRef = useRef<HTMLDivElement>(null)
    const menuAnchorRef = useRef<HTMLSpanElement>(null)
    const menuAnchorName = `--file-menu-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
    const supportsPopover = 'popover' in HTMLElement.prototype

    useLayoutEffect(() => {
        const menu = menuRef.current
        const anchor = menuAnchorRef.current
        if (!contextMenu || !menu || !anchor) return
        const anchored = supportsPopover && CSS.supports('position-area: block-end') &&
            CSS.supports('position-anchor: --test')
        anchor.style.setProperty('anchor-name', menuAnchorName)
        menu.style.setProperty('position-anchor', anchored ? menuAnchorName : 'auto')
        if (supportsPopover) {
            if (menu.matches(':popover-open')) menu.hidePopover()
            menu.showPopover()
        }
        if (!anchored) {
            const rect = menu.getBoundingClientRect()
            menu.style.left = `${Math.max(0, Math.min(contextMenu.x, window.innerWidth - rect.width))}px`
            menu.style.top = `${Math.max(0, Math.min(contextMenu.y, window.innerHeight - rect.height))}px`
        } else {
            menu.style.removeProperty('left')
            menu.style.removeProperty('top')
        }
        if (contextMenu.keyboard) menu.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true})
    }, [contextMenu, menuAnchorName, supportsPopover])

    useEffect(() => {
        if (!contextMenu) return
        const dismiss = () => setContextMenu(null)
        const pointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target)) dismiss()
        }
        const focusIn = (event: FocusEvent) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target)) dismiss()
        }
        const keyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                contextMenu.previousFocus?.focus({preventScroll: true})
                dismiss()
            } else if (event.key === 'Tab') {
                window.setTimeout(dismiss, 0)
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
                if (!items.length) return
                const current = items.findIndex(item => item === document.activeElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : current < 0 ? 0 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
                items[next].focus({preventScroll: true})
            }
        }
        document.addEventListener('pointerdown', pointerDown)
        document.addEventListener('focusin', focusIn)
        document.addEventListener('keydown', keyDown)
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        return () => {
            document.removeEventListener('pointerdown', pointerDown)
            document.removeEventListener('focusin', focusIn)
            document.removeEventListener('keydown', keyDown)
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
        }
    }, [contextMenu])

    useEffect(() => {
        if (!active) setContextMenu(null)
    }, [active])

    const openContextMenu = (name: string, isDir: boolean, x: number, y: number, keyboard: boolean) => {
        setContextMenu({
            name, isDir, x, y, keyboard,
            previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        })
    }

    const handleContextMenu = (event: MouseEvent<HTMLElement>, name: string, isDir: boolean) => {
        if (busy) return
        event.preventDefault()
        openContextMenu(name, isDir, event.clientX, event.clientY, false)
    }

    const handleContextKey = (event: KeyboardEvent<HTMLElement>, name: string, isDir: boolean) => {
        if (busy || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return
        event.preventDefault()
        const rect = event.target instanceof HTMLElement ? event.target.getBoundingClientRect() : event.currentTarget.getBoundingClientRect()
        openContextMenu(name, isDir, rect.left, rect.bottom, true)
    }

    useEffect(() => {
        let disposed = false
        mounted.current = true
        setBusy(true)
        setError('')
        setStatus('Connecting...')
        const details = session.details
        void ConnectBrowser(session.id, {
            host: details.host, port: details.port, username: details.username,
            authMethod: details.authMethod, password: details.password, privateKeyPath: details.privateKeyPath,
            passphrase: details.passphrase, savedId: details.savedId ?? '', startupCommand: '',
            cols: 0, rows: 0,
        }).then(result => {
            if (disposed) {
                void DisconnectBrowser(session.id).catch(console.error)
                return
            }
            setDirectory(result)
            setInput(result.path)
            setStatus('Connected')
        }).catch(reason => {
            if (!disposed) {
                setError(`Connection failed: ${String(reason)}`)
                setStatus('Disconnected')
            }
        }).finally(() => {
            if (!disposed) setBusy(false)
        })
        return () => {
            disposed = true
            mounted.current = false
            void DisconnectBrowser(session.id).catch(console.error)
        }
    }, [session.id, attempt])

    const navigate = async (target: string) => {
        setContextMenu(null)
        setBusy(true)
        setError('')
        try {
            const result = await ListDirectory(session.id, target)
            if (!mounted.current) return
            setDirectory(result)
            setInput(result.path)
        } catch (reason) {
            if (mounted.current) setError(`Could not open directory: ${String(reason)}`)
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    const upload = async () => {
        if (!directory) return
        setBusy(true)
        setError('')
        setStatus('Choose a file to upload...')
        let uploaded = false
        try {
            const result = await UploadFile(session.id, directory.path)
            if (!mounted.current) return
            if (result) {
                uploaded = true
                setStatus(`Uploaded ${result}`)
                const updated = await ListDirectory(session.id, directory.path)
                if (mounted.current) setDirectory(updated)
            } else setStatus('Connected')
        } catch (reason) {
            if (mounted.current) {
                if (!uploaded) setStatus('Transfer failed')
                setError(`${uploaded ? 'Upload succeeded, but could not refresh directory' : 'Upload failed'}: ${String(reason)}`)
            }
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    const download = async (name: string) => {
        if (!directory) return {message: 'Download failed: No directory is open.', failed: true}
        setBusy(true)
        setError('')
        setStatus('Choose a download destination...')
        try {
            const result = await DownloadFile(session.id, remoteChild(directory.path, name))
            if (mounted.current) setStatus(result ? `Downloaded to ${result}` : 'Connected')
            return {message: result ? `Downloaded to ${result}` : 'Download cancelled.', failed: false}
        } catch (reason) {
            const message = `Download failed: ${String(reason)}`
            if (mounted.current) {
                setStatus('Transfer failed')
                setError(message)
            }
            return {message, failed: true}
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    const playVideo = async (name: string, path: string) => {
        setBusy(true)
        setError('')
        setStatus('Opening video in VLC...')
        try {
            const started = await PlayVideo(session.id, path)
            if (!mounted.current) return
            if (started) setStatus(`Opened ${name} in VLC`)
            else {
                setStatus('VLC player not found')
                setMissingVLCVideo(name)
            }
        } catch (reason) {
            if (mounted.current) {
                setStatus('Could not open video')
                setError(`Could not play video: ${String(reason)}`)
            }
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    const openEntry = (name: string, isDir: boolean) => {
        if (!directory) return
        if (isDir && name === '..') {
            void navigate(parentDirectory(directory.path))
            return
        }
        const path = remoteChild(directory.path, name)
        if (isDir) void navigate(path)
        else if (isVideoFile(name)) void playVideo(name, path)
        else {
            setHtmlSource(false)
            setViewedFile(path)
        }
    }

    const visibleEntries = useMemo(() => visibleFileEntries(directory?.entries ?? [], showHidden, sortBy, sortDirection),
        [directory, showHidden, sortBy, sortDirection])
    const matchNames = useMemo(() => matchingFileNames(visibleEntries, showFind ? query : ''),
        [visibleEntries, showFind, query])
    const matchIndex = matchNames.length ? currentMatch % matchNames.length : 0
    const matchedNames = useMemo(() => new Set(matchNames), [matchNames])
    const findStatus = !query ? 'Enter a file name to search.' : matchNames.length
        ? `${matchIndex + 1} of ${matchNames.length} matching ${matchNames.length === 1 ? 'entry' : 'entries'}`
        : 'No matching entries.'
    const images = directory ? visibleEntries.filter(entry => !entry.isDir && imageMimeType(entry.name))
        .map(entry => remoteChild(directory.path, entry.name)) : []

    useEffect(() => {
        if (showFind) {
            findInputRef.current?.focus()
            findInputRef.current?.select()
        }
    }, [showFind])

    useLayoutEffect(() => {
        const keyDown = (event: globalThis.KeyboardEvent) => {
            if (!active || !directory || viewedFile || missingVLCVideo || event.defaultPrevented ||
                event.isComposing || event.altKey || event.shiftKey || !paneRef.current?.getClientRects().length ||
                document.querySelector('dialog:modal')) return
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                setShowFind(true)
                findInputRef.current?.focus()
                findInputRef.current?.select()
            }
        }
        window.addEventListener('keydown', keyDown, true)
        return () => window.removeEventListener('keydown', keyDown, true)
    }, [active, directory, viewedFile, missingVLCVideo])

    useEffect(() => {
        if (active && showFind && matchNames.length) {
            tableRef.current?.querySelector('[data-file-search-current="true"]')
                ?.scrollIntoView({block: 'nearest', inline: 'nearest'})
        }
    }, [active, showFind, matchNames, matchIndex, view])

    useEffect(() => {
        const timeout = window.setTimeout(() => setFindAnnouncement(showFind ? findStatus : ''), 350)
        return () => window.clearTimeout(timeout)
    }, [showFind, findStatus])

    const closeFind = () => {
        setShowFind(false)
        setQuery('')
        setCurrentMatch(0)
        findButtonRef.current?.focus()
    }

    const moveMatch = (direction: number) => {
        if (matchNames.length) setCurrentMatch((matchIndex + direction + matchNames.length) % matchNames.length)
    }

    return (
        <div ref={paneRef} className="file-browser-pane" hidden={!active}>
            <div className="file-browser-status" role="status">{status}</div>
            {error && <p className="file-browser-error" role="alert">{error}</p>}
            {error && directory && <button type="button" className="secondary" disabled={busy} onClick={() => {
                setDirectory(null)
                setAttempt(value => value + 1)
            }}>Reconnect</button>}
            {!directory && !busy && <button type="button" className="secondary"
                onClick={() => setAttempt(value => value + 1)}>Retry connection</button>}
            {missingVLCVideo && <VLCMissingDialog onClose={() => setMissingVLCVideo(null)}
                onDownload={() => void download(missingVLCVideo)}/>}
            {viewedFile && (imageMimeType(viewedFile)
                ? <ImageViewer sessionId={session.id} path={viewedFile} images={images}
                    onChange={setViewedFile} onClose={() => setViewedFile(null)}
                    onDownload={path => download(path.substring(path.lastIndexOf('/') + 1))}/>
                : /\.html?$/i.test(viewedFile) && !htmlSource
                ? <HtmlViewer sessionId={session.id} path={viewedFile} onClose={() => setViewedFile(null)}
                    onViewSource={() => setHtmlSource(true)}/>
                : <TextViewer key={viewedFile} sessionId={session.id} path={viewedFile}
                    onClose={() => setViewedFile(null)}/>)}
            {directory && (
                <>
                    {directory.ownerWarning && <p className="file-browser-owner-warning" role="status">{directory.ownerWarning}</p>}
                    <div className="file-browser-toolbar">
                        <button type="button" className="secondary" disabled={busy || directory.path === '/'}
                                onClick={() => void navigate(parentDirectory(directory.path))}>Up</button>
                        <form onSubmit={event => { event.preventDefault(); void navigate(input) }}>
                            <label htmlFor={`file-path-${session.id}`}>Remote directory</label>
                            <input id={`file-path-${session.id}`} name="path" value={input} required
                                   disabled={busy} onChange={event => setInput(event.target.value)}/>
                            <button type="submit" className="secondary" disabled={busy}>Go</button>
                        </form>
                        <button type="button" className="secondary" disabled={busy}
                                onClick={() => void navigate(directory.path)}>Refresh</button>
                        <button type="button" className="primary" disabled={busy}
                                onClick={() => void upload()}>Upload file</button>
                    </div>
                    <div className="file-browser-view-controls">
                        <div className="file-view-options" role="group" aria-label="File view">
                            <button type="button" className="secondary" aria-pressed={view === 'list'}
                                    onClick={() => setView('list')}>List</button>
                            <button type="button" className="secondary" aria-pressed={view === 'grid'}
                                    onClick={() => setView('grid')}>Grid</button>
                        </div>
                        <button ref={findButtonRef} type="button" className="secondary" aria-expanded={showFind}
                            aria-controls={`${findId}-find`} onClick={() => showFind ? closeFind() : setShowFind(true)}>
                            Find files
                        </button>
                        <label className="file-hidden-toggle">
                            <input type="checkbox" checked={showHidden}
                                   onChange={event => setShowHidden(event.target.checked)}/>
                            Show hidden files
                        </label>
                        <label className="file-sort-control">
                            Sort by
                            <select value={sortBy} onChange={event => {
                                const value = event.target.value as FileSort
                                setSortBy(value)
                                setSortStatus(`Sorted by ${value}, ${sortDirection}, ${visibleEntries.length} items`)
                            }}>
                                <option value="name">Name</option>
                                <option value="size">Size</option>
                                <option value="modified">Modified</option>
                                <option value="owner">Owner</option>
                            </select>
                        </label>
                        <label className="file-sort-control">
                            Order
                            <select value={sortDirection} onChange={event => {
                                const value = event.target.value as SortDirection
                                setSortDirection(value)
                                setSortStatus(`Sorted by ${sortBy}, ${value}, ${visibleEntries.length} items`)
                            }}>
                                <option value="ascending">Ascending</option>
                                <option value="descending">Descending</option>
                            </select>
                        </label>
                        <span className="file-sort-status" role="status">{sortStatus}</span>
                    </div>
                    <div id={`${findId}-find`} className="file-search" hidden={!showFind}>
                        <label htmlFor={`${findId}-query`}>Search file names</label>
                        <input ref={findInputRef} id={`${findId}-query`} type="search" value={query} spellCheck={false}
                            aria-describedby={`${findId}-status`}
                            onChange={event => { setQuery(event.target.value); setCurrentMatch(0) }}
                            onKeyDown={event => {
                                if (event.nativeEvent.isComposing) return
                                if (event.key === 'Escape') { event.preventDefault(); closeFind() }
                                else if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) }
                            }}/>
                        <span id={`${findId}-status`}>{findStatus}</span>
                        <span className="file-sort-status" role="status">{findAnnouncement}</span>
                        <button type="button" className="secondary" disabled={!matchNames.length}
                            onClick={() => moveMatch(-1)}>Previous match</button>
                        <button type="button" className="secondary" disabled={!matchNames.length}
                            onClick={() => moveMatch(1)}>Next match</button>
                        <button type="button" className="secondary" onClick={closeFind}>Close search</button>
                    </div>
                    <div ref={tableRef} className="file-table-wrapper" role="region" aria-label="Remote directory contents" tabIndex={0}>
                        {view === 'list' ? (
                        <table className="file-table">
                            <caption>Files in {directory.path}</caption>
                            <thead><tr><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Modified</th><th scope="col">Owner</th><th scope="col">Action</th><th scope="col">Permissions</th></tr></thead>
                            <tbody>
                            {directory.path !== '/' && <tr
                                onContextMenu={event => handleContextMenu(event, '..', true)}
                                onKeyDown={event => handleContextKey(event, '..', true)}>
                                <th scope="row">
                                    <button type="button" className="file-name file-list-name" disabled={busy}
                                        aria-label=".. (parent folder)" onClick={() => openEntry('..', true)}>
                                        <FileIcon name=".." folder/>
                                        <span>..</span>
                                    </button>
                                </th>
                                <td></td><td></td><td></td><td></td><td></td>
                            </tr>}
                            {visibleEntries.map(entry => (
                                <tr key={entry.name} data-file-search-current={matchNames[matchIndex] === entry.name || undefined}
                                    onContextMenu={event => handleContextMenu(event, entry.name, entry.isDir)}
                                    onKeyDown={event => handleContextKey(event, entry.name, entry.isDir)}>
                                    <th scope="row">
                                        <button type="button" className={`file-name file-list-name${matchedNames.has(entry.name) ? ' file-search-match' : ''}`} disabled={busy}
                                            aria-label={`Open ${entry.isDir ? 'folder' : 'file'} ${entry.name}${entry.isDir ? '/' : ''}${matchedNames.has(entry.name) ? matchNames[matchIndex] === entry.name ? ', current search match' : ', search match' : ''}`}
                                            onClick={() => openEntry(entry.name, entry.isDir)}>
                                            <FileIcon name={entry.name} folder={entry.isDir}/>
                                            <span>{entry.name}{entry.isDir ? '/' : ''}</span>
                                        </button>
                                    </th>
                                    <td>{formatSize(entry.size)}</td>
                                    <td>{entry.modified}</td>
                                    <td>{entry.owner}</td>
                                    <td>{!entry.isDir &&
                                        <button type="button" className="secondary" disabled={busy}
                                            aria-label={`Download ${entry.name}`} onClick={() => void download(entry.name)}>Download</button>}</td>
                                    <td className="file-permissions">{entry.permissions}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        ) : (
                            <div className="file-grid" aria-label={`Files in ${directory.path}`}>
                                {directory.path !== '/' && <article className="file-card"
                                    onContextMenu={event => handleContextMenu(event, '..', true)}
                                    onKeyDown={event => handleContextKey(event, '..', true)}>
                                    <h3>
                                        <button type="button" className="file-name file-grid-name" disabled={busy}
                                            aria-label=".. (parent folder)" onClick={() => openEntry('..', true)}>
                                            <FileIcon name=".." folder/>
                                            <span>..</span>
                                        </button>
                                    </h3>
                                </article>}
                                {visibleEntries.map(entry => (
                                    <article className="file-card" key={entry.name}
                                        data-file-search-current={matchNames[matchIndex] === entry.name || undefined}
                                        onContextMenu={event => handleContextMenu(event, entry.name, entry.isDir)}
                                        onKeyDown={event => handleContextKey(event, entry.name, entry.isDir)}>
                                            <h3>
                                                <button type="button" className={`file-name file-grid-name${matchedNames.has(entry.name) ? ' file-search-match' : ''}`} disabled={busy}
                                                    aria-label={`Open ${entry.isDir ? 'folder' : 'file'} ${entry.name}${entry.isDir ? '/' : ''}${matchedNames.has(entry.name) ? matchNames[matchIndex] === entry.name ? ', current search match' : ', search match' : ''}`}
                                                    onClick={() => openEntry(entry.name, entry.isDir)}>
                                                    <FileIcon name={entry.name} folder={entry.isDir}/>
                                                    <span>{entry.name}{entry.isDir ? '/' : ''}</span>
                                                </button>
                                            </h3>
                                    </article>
                                ))}
                            </div>
                        )}
                        {visibleEntries.length === 0 && <p className="file-empty">
                            {directory.entries.length === 0 ? 'This directory is empty.' : 'No files to show. Hidden files are filtered out.'}
                        </p>}
                    </div>
                </>
            )}
            {contextMenu && createPortal(<>
                <span ref={menuAnchorRef} className="file-context-anchor" aria-hidden="true"
                      style={{left: contextMenu.x, top: contextMenu.y}}/>
                <div ref={menuRef} className="file-context-menu" popover={supportsPopover ? 'manual' : undefined}
                     role="menu" aria-label={`Actions for ${contextMenu.name}`}>
                    <button type="button" role="menuitem" tabIndex={-1}
                            onPointerMove={event => event.currentTarget.focus({preventScroll: true})}
                            onClick={() => {
                                const {name, isDir, previousFocus} = contextMenu
                                previousFocus?.focus({preventScroll: true})
                                setContextMenu(null)
                                openEntry(name, isDir)
                            }}>Open</button>
                    {!contextMenu.isDir && <button type="button" role="menuitem" tabIndex={-1}
                            onPointerMove={event => event.currentTarget.focus({preventScroll: true})}
                            onClick={() => {
                                const name = contextMenu.name
                                contextMenu.previousFocus?.focus({preventScroll: true})
                                setContextMenu(null)
                                void download(name)
                            }}>Download</button>}
                </div>
            </>, document.body)}
        </div>
    )
}

export default function FileBrowser() {
    const [sessions, setSessions] = useState<Session[]>([])
    const [active, setActive] = useState('new')
    const {logins, error, setError, save, remove} = useSSHLogins()

    const open = (details: ConnectionDetails) => {
        const id = crypto.randomUUID()
        setSessions(current => [...current, {id, details}])
        setActive(id)
    }
    const close = (id: string) => {
        setSessions(current => current.filter(session => session.id !== id))
        setActive(current => current === id ? 'new' : current)
    }

    return (
        <div className="file-browser">
            <div className="session-bar">
                {sessions.map(session => (
                    <div className="session-tab-group" key={session.id}>
                        <button type="button" className={`session-tab ${active === session.id ? 'active' : ''}`}
                                onClick={() => setActive(session.id)}>{session.details.username}@{session.details.host}</button>
                        <button type="button" className="session-close"
                                aria-label={`Close ${session.details.username}@${session.details.host} file session`}
                                onClick={() => close(session.id)}>×</button>
                    </div>
                ))}
                <button type="button" className={`session-add ${active === 'new' ? 'active' : ''}`}
                        aria-label="New file connection" onClick={() => setActive('new')}>+</button>
            </div>
            <div className="file-browser-body">
                {active === 'new' && <>
                    {error && <button type="button" className="ssh-error" onClick={() => setError('')}>{error}</button>}
                    <NewConnection files logins={logins} onConnect={open} onSave={save} onDelete={remove}/>
                </>}
                {sessions.map(session => <BrowserPane key={session.id} session={session} active={active === session.id}/>)}
            </div>
        </div>
    )
}
