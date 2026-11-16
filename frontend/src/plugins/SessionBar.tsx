import {useCallback, useLayoutEffect, useRef, useState} from 'react'
import type {ReactNode} from 'react'

export default function SessionBar({children, sessionCount, activeKey}: {
    children: ReactNode
    sessionCount: number
    activeKey: string
}) {
    const scroll = useRef<HTMLDivElement>(null)
    const items = useRef<HTMLDivElement>(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)

    const updateScroll = useCallback(() => {
        const element = scroll.current
        if (!element) return
        setCanScrollLeft(element.scrollLeft > 1)
        setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 1)
    }, [])

    useLayoutEffect(() => {
        const element = scroll.current
        const content = items.current
        if (!element || !content) return
        const observer = new ResizeObserver(updateScroll)
        observer.observe(element)
        observer.observe(content)
        updateScroll()
        return () => observer.disconnect()
    }, [updateScroll])

    useLayoutEffect(() => {
        const element = scroll.current
        const selected = element?.querySelector<HTMLElement>('.session-tab.active, .session-add.active')
        if (!element || !selected) return
        const tab = selected.closest<HTMLElement>('.session-tab-group') ?? selected
        const viewport = element.getBoundingClientRect()
        const bounds = tab.getBoundingClientRect()
        if (bounds.left < viewport.left) element.scrollLeft += bounds.left - viewport.left
        else if (bounds.right > viewport.right) element.scrollLeft += bounds.right - viewport.right
        updateScroll()
    }, [activeKey, sessionCount, updateScroll])

    const move = (direction: -1 | 1) => {
        const element = scroll.current
        if (!element) return
        element.scrollBy({left: direction * Math.max(120, element.clientWidth * 0.75)})
        updateScroll()
    }

    return <div className="session-bar">
        {sessionCount > 1 && <button type="button" className="session-scroll-control"
            aria-label="Scroll tabs left" title="Scroll tabs left" aria-disabled={!canScrollLeft}
            onClick={() => { if (canScrollLeft) move(-1) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>}
        <div ref={scroll} className="session-bar-scroll" onScroll={updateScroll}>
            <div ref={items} className="session-bar-items">{children}</div>
        </div>
        {sessionCount > 1 && <button type="button" className="session-scroll-control"
            aria-label="Scroll tabs right" title="Scroll tabs right" aria-disabled={!canScrollRight}
            onClick={() => { if (canScrollRight) move(1) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>}
    </div>
}
