import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

interface Props {
    title: string
    active: boolean
    closeLabel: string
    onSelect: () => void
    onClose: () => void
    onDuplicate: () => void
}

interface MenuPosition {
    x: number
    y: number
    keyboard: boolean
}

export default function SessionTab({title, active, closeLabel, onSelect, onClose, onDuplicate}: Props) {
    const [menu, setMenu] = useState<MenuPosition | null>(null)
    const tabRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const supportsPopover = 'popover' in HTMLElement.prototype

    useLayoutEffect(() => {
        const element = menuRef.current
        if (!menu || !element) return
        if (supportsPopover) element.showPopover()
        const rect = element.getBoundingClientRect()
        element.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - rect.width))}px`
        element.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - rect.height))}px`
        if (menu.keyboard) element.querySelector('button')?.focus({preventScroll: true})
    }, [menu, supportsPopover])

    useEffect(() => {
        if (!menu) return
        const dismiss = (event: PointerEvent | FocusEvent) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null)
        }
        const keyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                setMenu(null)
                tabRef.current?.focus({preventScroll: true})
            } else if (event.key === 'Tab') {
                window.setTimeout(() => setMenu(null), 0)
            }
        }
        const dismissOnScroll = () => setMenu(null)
        document.addEventListener('pointerdown', dismiss)
        document.addEventListener('focusin', dismiss)
        document.addEventListener('keydown', keyDown)
        window.addEventListener('scroll', dismissOnScroll, true)
        window.addEventListener('resize', dismissOnScroll)
        return () => {
            document.removeEventListener('pointerdown', dismiss)
            document.removeEventListener('focusin', dismiss)
            document.removeEventListener('keydown', keyDown)
            window.removeEventListener('scroll', dismissOnScroll, true)
            window.removeEventListener('resize', dismissOnScroll)
        }
    }, [menu])

    return (
        <div className="session-tab-group">
            <button ref={tabRef} type="button" className={`session-tab ${active ? 'active' : ''}`}
                    title={title} onClick={onSelect}
                    onContextMenu={event => {
                        event.preventDefault()
                        setMenu({x: event.clientX, y: event.clientY, keyboard: false})
                    }}
                    onKeyDown={event => {
                        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenu({x: rect.left, y: rect.bottom, keyboard: true})
                    }}>
                {title}
            </button>
            <button type="button" className="session-close" title="Close session"
                    aria-label={closeLabel} onClick={onClose}>×</button>
            {menu && createPortal(
                <div ref={menuRef} className="tab-context-menu" popover={supportsPopover ? 'manual' : undefined}
                     role="menu" aria-label={`Actions for ${title}`}>
                    <button type="button" role="menuitem" onClick={() => {
                        setMenu(null)
                        tabRef.current?.focus({preventScroll: true})
                        onDuplicate()
                    }}>Duplicate tab</button>
                </div>,
                document.body,
            )}
        </div>
    )
}
