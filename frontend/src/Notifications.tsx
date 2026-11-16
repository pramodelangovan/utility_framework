import {useCallback, useEffect, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {NotificationContext} from './NotificationContext'
import type {NoticeKind} from './NotificationContext'

interface Notice {
    id: number
    message: string
    kind: NoticeKind
    previousFocus: HTMLElement | null
}

type Theme = 'dark' | 'light'

function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>(
        () => (localStorage.getItem('theme') as Theme) || 'dark'
    )
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

    useEffect(() => {
        document.documentElement.dataset.theme = theme
        localStorage.setItem('theme', theme)
    }, [theme])

    return <button type="button" className="corner-icon-button theme-toggle" aria-label={label} title={label}
        onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {theme === 'dark'
                ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>
                : <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>}
        </svg>
    </button>
}

function Toast({notice, modal, dismiss}: {notice: Notice; modal: boolean; dismiss: (notice: Notice) => void}) {
    const [focused, setFocused] = useState(false)
    const [hovered, setHovered] = useState(false)

    useEffect(() => {
        if (focused || hovered || modal) return
        const timer = window.setTimeout(() => dismiss(notice), 6000)
        return () => window.clearTimeout(timer)
    }, [notice, focused, hovered, modal, dismiss])

    return <div className={`toast toast-${notice.kind}`} data-toast-id={notice.id}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <span>{notice.message}</span>
        <button type="button" className="toast-dismiss" aria-label="Dismiss notification"
                onClick={() => dismiss(notice)}>×</button>
    </div>
}

export function NotificationProvider({children}: {children: ReactNode}) {
    const [visible, setVisible] = useState<Notice[]>([])
    const [history, setHistory] = useState<Notice[]>([])
    const [historyOpen, setHistoryOpen] = useState(false)
    const [modal, setModal] = useState(false)
    const [announcement, setAnnouncement] = useState<{id: number; message: string} | null>(null)
    const queue = useRef<Notice[]>([])
    const nextId = useRef(0)
    const region = useRef<HTMLDivElement>(null)
    const supportsPopover = 'popover' in HTMLElement.prototype

    const flush = useCallback(() => {
        if (document.querySelector('dialog:modal') || !queue.current.length) return
        const pending = queue.current
        queue.current = []
        setVisible(current => [...current, ...pending])
        const last = pending[pending.length - 1]
        const announcer = document as Document & {ariaNotify?: (message: string) => void}
        if (typeof announcer.ariaNotify === 'function') {
            for (const notice of pending) announcer.ariaNotify(notice.message)
        } else {
            setAnnouncement({id: last.id, message: pending.map(notice => notice.message).join('. ')})
        }
    }, [])

    const notify = useCallback((message: string, kind: NoticeKind = 'success') => {
        const notice = {
            id: ++nextId.current, message, kind,
            previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        }
        queue.current.push(notice)
        setHistory(current => [notice, ...current].slice(0, 100))
        queueMicrotask(flush)
    }, [flush])

    const dismiss = useCallback((notice: Notice) => {
        const element = region.current?.querySelector(`[data-toast-id="${notice.id}"]`)
        if (element?.contains(document.activeElement)) {
            const next = region.current?.querySelector<HTMLButtonElement>(
                `[data-toast-id]:not([data-toast-id="${notice.id}"]) .toast-dismiss`)
            if (next) next.focus({preventScroll: true})
            else if (notice.previousFocus?.isConnected && !notice.previousFocus.closest('[inert]')) {
                notice.previousFocus.focus({preventScroll: true})
            }
            if (element.contains(document.activeElement)) {
                region.current?.querySelector<HTMLButtonElement>('.notification-history-toggle')?.focus({preventScroll: true})
            }
        }
        setVisible(current => current.filter(item => item.id !== notice.id))
    }, [])

    useEffect(() => {
        if (supportsPopover) region.current?.showPopover()
        const update = () => {
            const open = !!document.querySelector('dialog:modal')
            setModal(open)
            if (!open) flush()
        }
        const observer = new MutationObserver(update)
        observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open']})
        document.addEventListener('close', update, true)
        update()
        return () => {
            observer.disconnect()
            document.removeEventListener('close', update, true)
        }
    }, [flush, supportsPopover])

    return <NotificationContext.Provider value={notify}>
        {children}
        {createPortal(<div ref={region} className="notifications" data-notifications=""
            popover={supportsPopover ? 'manual' : undefined} role="region" aria-label="Notifications">
            <div className="notification-announcement" aria-live="polite" aria-atomic="true">
                {announcement && <span key={announcement.id}>{announcement.message}</span>}
            </div>
            <div className="toast-stack">
                {visible.map(notice => <Toast key={notice.id} notice={notice} modal={modal} dismiss={dismiss}/>)}
            </div>
            <div id="notification-history" className="notification-history" hidden={!historyOpen}>
                <div className="notification-history-header">
                    <span>Notifications</span>
                    <button type="button" className="notification-history-clear"
                        aria-label="Clear notification history" aria-disabled={history.length === 0}
                        onClick={() => { if (history.length) setHistory([]) }}>
                        <span aria-hidden="true">×</span> Clear
                    </button>
                </div>
                {history.length === 0 ? <p role="status">No notifications yet.</p> : <ul role="list">
                    {history.map(notice => <li key={notice.id} className={`notification-${notice.kind}`}>{notice.message}</li>)}
                </ul>}
            </div>
            <div className="corner-controls">
                <ThemeToggle/>
                <button type="button" className="corner-icon-button notification-history-toggle"
                    aria-label="Notification history" title="Notification history"
                    aria-controls="notification-history" aria-expanded={historyOpen}
                    onClick={() => setHistoryOpen(open => !open)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>
                    </svg>
                </button>
            </div>
        </div>, document.body)}
    </NotificationContext.Provider>
}
