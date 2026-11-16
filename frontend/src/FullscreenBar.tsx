import {useState} from 'react'
import type {ReactNode} from 'react'
import {createPortal} from 'react-dom'

export default function FullscreenBar({children, label, portal = false}: {children: ReactNode; label: string; portal?: boolean}) {
    const [pinned, setPinned] = useState(false)
    const [revealed, setRevealed] = useState(false)

    const bar = (
        <div className={`fullscreen-bar${pinned ? ' pinned' : ''}${revealed ? ' revealed' : ''}`}
             data-fullscreen-controls={portal ? 'vnc' : undefined}
             onPointerEnter={() => setRevealed(true)}
             onPointerLeave={() => setRevealed(false)}
             onFocusCapture={() => setRevealed(true)}
             onBlurCapture={event => {
                 if (!event.currentTarget.matches(':hover') &&
                     (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))) {
                     setRevealed(false)
                 }
             }}
             onClickCapture={event => {
                 if (event.detail > 0 && event.target instanceof Element) event.target.closest('button')?.blur()
             }}>
            <div className="fullscreen-bar-content">
                {children}
                <button type="button" className="secondary fullscreen-pin" aria-label="Pin top bar"
                        aria-pressed={pinned} title={pinned ? 'Unpin top bar' : 'Pin top bar'}
                        onClick={() => setPinned(value => !value)}>
                    Pin
                </button>
            </div>
            <button type="button" className="fullscreen-bar-reveal"
                    aria-label={`Show ${label}`} aria-expanded={pinned || revealed}
                    onClick={() => setRevealed(value => !value)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6"/>
                </svg>
            </button>
        </div>
    )
    return portal ? createPortal(bar, document.body) : bar
}
