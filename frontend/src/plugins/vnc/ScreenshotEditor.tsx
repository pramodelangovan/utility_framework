import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {KeyboardEvent, PointerEvent} from 'react'
import {SaveScreenshot} from '../../../wailsjs/go/vnc/Service'
import {useNotifications} from '../../NotificationContext'

export interface Snapshot {
    data: string
    width: number
    height: number
}

interface Point {
    x: number
    y: number
}

interface Crop extends Point {
    width: number
    height: number
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Drag =
    | {kind: 'draw'; anchor: Point}
    | {kind: 'move'; anchor: Point; original: Crop}
    | {kind: 'resize'; anchor: Point}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function rectangle(a: Point, b: Point, image: Snapshot): Crop {
    const x = clamp(Math.min(a.x, b.x), 0, image.width - 1)
    const y = clamp(Math.min(a.y, b.y), 0, image.height - 1)
    return {
        x, y,
        width: clamp(Math.abs(b.x - a.x), 1, image.width - x),
        height: clamp(Math.abs(b.y - a.y), 1, image.height - y),
    }
}

export default function ScreenshotEditor({snapshot, onClose}: {snapshot: Snapshot; onClose: () => void}) {
    const notify = useNotifications()
    const dialog = useRef<HTMLDialogElement>(null)
    const overlay = useRef<HTMLDivElement>(null)
    const preview = useRef<HTMLDivElement>(null)
    const image = useRef<HTMLDivElement>(null)
    const drag = useRef<Drag | null>(null)
    const pan = useRef<{x: number; y: number; left: number; top: number} | null>(null)
    const zoomTarget = useRef<{x: number; y: number; clientX: number; clientY: number} | null>(null)
    const spaceHeld = useRef(false)
    const pointerOverPreview = useRef(false)
    const [name, setName] = useState('')
    const [cropEnabled, setCropEnabled] = useState(false)
    const [crop, setCrop] = useState<Crop | null>(null)
    const [pointer, setPointer] = useState<Point>({x: Math.floor(snapshot.width / 2), y: Math.floor(snapshot.height / 2)})
    const [anchor, setAnchor] = useState<Point | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [savedPath, setSavedPath] = useState('')
    const [viewport, setViewport] = useState({width: 0, height: 0})
    const [zoom, setZoom] = useState(1)
    const [panning, setPanning] = useState(false)

    useEffect(() => {
        dialog.current?.showModal()
    }, [])

    useEffect(() => {
        setSavedPath('')
        setError('')
    }, [name, cropEnabled, crop])

    useEffect(() => {
        const element = preview.current
        if (!element) return
        const update = () => setViewport({width: element.clientWidth, height: element.clientHeight})
        const observer = new ResizeObserver(update)
        observer.observe(element)
        update()
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const releaseSpace = (event: globalThis.KeyboardEvent) => {
            if (event.code === 'Space') {
                spaceHeld.current = false
                pan.current = null
                setPanning(false)
            }
        }
        const reset = () => {
            spaceHeld.current = false
            pan.current = null
            setPanning(false)
        }
        window.addEventListener('keyup', releaseSpace)
        window.addEventListener('blur', reset)
        return () => {
            window.removeEventListener('keyup', releaseSpace)
            window.removeEventListener('blur', reset)
        }
    }, [])

    useLayoutEffect(() => {
        const target = zoomTarget.current
        if (!target || !preview.current || !image.current) return
        const bounds = image.current.getBoundingClientRect()
        preview.current.scrollLeft += bounds.left + target.x * bounds.width - target.clientX
        preview.current.scrollTop += bounds.top + target.y * bounds.height - target.clientY
        zoomTarget.current = null
    }, [zoom])

    const changeZoom = (next: number, clientX: number, clientY: number) => {
        if (!image.current) return
        next = clamp(next, 1, 8)
        if (next === zoom) return
        const bounds = image.current.getBoundingClientRect()
        zoomTarget.current = {
            x: (clientX - bounds.left) / bounds.width,
            y: (clientY - bounds.top) / bounds.height,
            clientX,
            clientY,
        }
        setZoom(next)
    }

    useEffect(() => {
        const element = preview.current
        if (!element) return
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey || !image.current || event.deltaY === 0) return
            event.preventDefault()
            const focusTarget = overlay.current ?? element
            focusTarget.focus({preventScroll: true})
            changeZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY)
        }
        element.addEventListener('wheel', wheel, {passive: false})
        return () => element.removeEventListener('wheel', wheel)
    }, [zoom])

    const imagePoint = (event: PointerEvent): Point => {
        const bounds = overlay.current!.getBoundingClientRect()
        return {
            x: clamp(Math.round((event.clientX - bounds.left) * snapshot.width / bounds.width), 0, snapshot.width),
            y: clamp(Math.round((event.clientY - bounds.top) * snapshot.height / bounds.height), 0, snapshot.height),
        }
    }

    const begin = (event: PointerEvent<HTMLElement>, kind: 'draw' | 'move' | Corner) => {
        if (!cropEnabled || saving || spaceHeld.current || event.button !== 0 || !overlay.current) return
        event.preventDefault()
        event.stopPropagation()
        const point = imagePoint(event)
        setPointer(point)
        setAnchor(null)
        if (kind === 'draw' || !crop) {
            drag.current = {kind: 'draw', anchor: point}
            setCrop(rectangle(point, point, snapshot))
        } else if (kind === 'move') {
            drag.current = {kind: 'move', anchor: point, original: crop}
        } else {
            drag.current = {
                kind: 'resize',
                anchor: {
                    x: kind.includes('w') ? crop.x + crop.width : crop.x,
                    y: kind.includes('n') ? crop.y + crop.height : crop.y,
                },
            }
        }
        overlay.current.setPointerCapture(event.pointerId)
        overlay.current.focus({preventScroll: true})
    }

    const move = (event: PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return
        const point = imagePoint(event)
        setPointer(point)
        const action = drag.current
        if (action.kind === 'move') {
            setCrop({
                ...action.original,
                x: clamp(action.original.x + point.x - action.anchor.x, 0, snapshot.width - action.original.width),
                y: clamp(action.original.y + point.y - action.anchor.y, 0, snapshot.height - action.original.height),
            })
        } else {
            setCrop(rectangle(action.anchor, point, snapshot))
        }
    }

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!cropEnabled || saving) return
        const directions: Record<string, Point> = {
            ArrowLeft: {x: -1, y: 0}, ArrowRight: {x: 1, y: 0},
            ArrowUp: {x: 0, y: -1}, ArrowDown: {x: 0, y: 1},
        }
        const direction = directions[event.key]
        const step = event.shiftKey ? 10 : 1
        const delta = direction && {x: direction.x * step, y: direction.y * step}
        if (delta) {
            event.preventDefault()
            if (crop) {
                if (event.ctrlKey) {
                    setCrop({
                        ...crop,
                        width: clamp(crop.width + delta.x, 1, snapshot.width - crop.x),
                        height: clamp(crop.height + delta.y, 1, snapshot.height - crop.y),
                    })
                } else {
                    setCrop({
                        ...crop,
                        x: clamp(crop.x + delta.x, 0, snapshot.width - crop.width),
                        y: clamp(crop.y + delta.y, 0, snapshot.height - crop.height),
                    })
                }
            } else {
                setPointer({
                    x: clamp(pointer.x + delta.x, 0, snapshot.width),
                    y: clamp(pointer.y + delta.y, 0, snapshot.height),
                })
            }
        } else if (event.key === 'Enter' && !crop) {
            event.preventDefault()
            if (anchor) {
                setCrop(rectangle(anchor, pointer, snapshot))
                setAnchor(null)
            } else {
                setAnchor(pointer)
            }
        }
    }

    const save = async () => {
        setError('')
        setSavedPath('')
        if (cropEnabled && !crop) {
            setError('Draw a crop box or turn off cropping before saving.')
            notify('Draw a crop box or turn off cropping before saving.', 'error')
            return
        }
        setSaving(true)
        try {
            const path = await SaveScreenshot(name, snapshot.data, crop ?? {x: 0, y: 0, width: 0, height: 0}, cropEnabled)
            if (path) {
                setSavedPath(path)
                notify(`Saved screenshot to ${path}`)
            }
        } catch (reason) {
            const message = `Could not save screenshot: ${String(reason)}`
            setError(message)
            notify(message, 'error')
        } finally {
            setSaving(false)
        }
    }

    const fit = Math.min(1, viewport.width / snapshot.width, viewport.height / snapshot.height)
    const imageWidth = snapshot.width * fit * zoom
    const imageHeight = snapshot.height * fit * zoom

    return (
        <dialog ref={dialog} className="screenshot-dialog" aria-labelledby="screenshot-title"
                onKeyDownCapture={event => {
                    if (event.code !== 'Space' || event.target instanceof HTMLTextAreaElement ||
                        (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') ||
                        (event.target instanceof HTMLElement && event.target.isContentEditable) ||
                        (!pointerOverPreview.current && (event.target instanceof HTMLButtonElement ||
                            event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement))) return
                    event.preventDefault()
                    spaceHeld.current = true
                    setPanning(true)
                }}
                onClose={onClose} onCancel={event => { if (saving) event.preventDefault() }}>
            <header className="screenshot-header">
                <h2 id="screenshot-title">Screenshot</h2>
                <button type="button" className="secondary" disabled={saving}
                        onClick={() => { dialog.current?.close(); onClose() }}>Close</button>
            </header>
            <div className="screenshot-content">
                <div ref={preview} className={`screenshot-preview${panning ? ' screenshot-preview-pan' : ''}`}
                     tabIndex={0} role="group" aria-label="Screenshot preview" aria-describedby="zoom-instructions"
                     onPointerEnter={() => { pointerOverPreview.current = true }}
                     onPointerLeave={() => { pointerOverPreview.current = false }}
                     onPointerDownCapture={event => {
                         if (!spaceHeld.current || event.button !== 0) {
                             if (!cropEnabled) event.currentTarget.focus({preventScroll: true})
                             return
                         }
                         event.preventDefault()
                         event.stopPropagation()
                         pan.current = {x: event.clientX, y: event.clientY,
                             left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop}
                         event.currentTarget.setPointerCapture(event.pointerId)
                     }}
                     onPointerMoveCapture={event => {
                         if (!pan.current) return
                         event.preventDefault()
                         event.stopPropagation()
                         event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX
                         event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY
                     }}
                     onPointerUpCapture={() => { pan.current = null }}
                     onPointerCancelCapture={() => { pan.current = null }}
                     onLostPointerCapture={() => { pan.current = null }}>
                    <div className="screenshot-stage" style={{minWidth: imageWidth, minHeight: imageHeight}}>
                        <div ref={image} className="screenshot-image" style={{width: imageWidth, height: imageHeight}}>
                            <img src={snapshot.data} alt="Captured VNC desktop" draggable={false}/>
                            {cropEnabled && (
                                <div ref={overlay} className="crop-overlay" tabIndex={0} role="group"
                                     aria-label="Crop selection" aria-describedby="crop-instructions"
                                     onPointerDown={event => begin(event, 'draw')}
                                     onPointerMove={move}
                                     onPointerUp={() => { drag.current = null }}
                                     onPointerCancel={() => { drag.current = null }}
                                     onLostPointerCapture={() => { drag.current = null }}
                                     onKeyDown={onKeyDown}>
                                    {!crop && (
                                        <span className="crop-pointer" aria-hidden="true"
                                              style={{left: `${pointer.x / snapshot.width * 100}%`, top: `${pointer.y / snapshot.height * 100}%`}}/>
                                    )}
                                    {crop && (
                                        <div className="crop-box"
                                             style={{left: `${crop.x / snapshot.width * 100}%`, top: `${crop.y / snapshot.height * 100}%`,
                                                 width: `${crop.width / snapshot.width * 100}%`, height: `${crop.height / snapshot.height * 100}%`}}
                                             onPointerDown={event => begin(event, 'move')}>
                                            {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
                                                <span key={corner} className={`crop-handle crop-handle-${corner}`} aria-hidden="true"
                                                      onPointerDown={event => begin(event, corner)}/>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <aside className="screenshot-options">
                    <p>Original: {snapshot.width} × {snapshot.height} pixels</p>
                    <p id="zoom-instructions">Ctrl+scroll to zoom. Hold Space and drag the image to pan. Zoom is relative to the fitted image.</p>
                    <div className="screenshot-zoom">
                        <button type="button" className="secondary" disabled={zoom <= 1} onClick={() => {
                            const bounds = preview.current!.getBoundingClientRect()
                            changeZoom(zoom / 1.2, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
                        }}>Zoom out</button>
                        <span>{Math.round(zoom * 100)}%</span>
                        <button type="button" className="secondary" disabled={zoom >= 8} onClick={() => {
                            const bounds = preview.current!.getBoundingClientRect()
                            changeZoom(zoom * 1.2, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
                        }}>Zoom in</button>
                    </div>
                    <label className="screenshot-crop-toggle">
                        <input type="checkbox" checked={cropEnabled} disabled={saving} onChange={event => {
                            setCropEnabled(event.target.checked)
                            setCrop(null)
                            setAnchor(null)
                        }}/>
                        Crop screenshot
                    </label>
                    {cropEnabled && (
                        <>
                            <p id="crop-instructions">Drag to draw, move, or resize the box. With the image focused, arrows move the box and Ctrl+arrows resize it. Hold Shift to move or resize faster. To draw with the keyboard, move the pointer with arrows and press Enter at each corner.</p>
                            <div className="crop-coordinates" role="group" aria-label="Crop coordinates">
                                <strong>Crop coordinates (pixels)</strong>
                                {crop ? (
                                    <>
                                        <span>Start: ({crop.x}, {crop.y})</span>
                                        <span>Width: {crop.width} · Height: {crop.height}</span>
                                        <span>Top left: ({crop.x}, {crop.y})</span>
                                        <span>Top right: ({crop.x + crop.width}, {crop.y})</span>
                                        <span>Bottom left: ({crop.x}, {crop.y + crop.height})</span>
                                        <span>Bottom right: ({crop.x + crop.width}, {crop.y + crop.height})</span>
                                        <button type="button" className="secondary" disabled={saving}
                                                onClick={() => { setCrop(null); setAnchor(null); overlay.current?.focus({preventScroll: true}) }}>Clear crop</button>
                                    </>
                                ) : <span>{anchor ? 'Choose the opposite corner.' : 'No crop selected.'}</span>}
                            </div>
                        </>
                    )}
                    <form onSubmit={event => { event.preventDefault(); void save() }}>
                        <label>
                            Capture name
                            <input name="name" required maxLength={120} value={name} disabled={saving}
                                   onChange={event => setName(event.target.value)} placeholder="my-capture"/>
                        </label>
                        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save screenshot'}</button>
                    </form>
                    {error && <p className="screenshot-error" role="alert">{error}</p>}
                    {savedPath && <p role="status">Saved to {savedPath}</p>}
                </aside>
            </div>
        </dialog>
    )
}
