import {useEffect, useId, useRef, useState} from 'react'
import {ReadImage} from '../../../wailsjs/go/ssh/Service'
import {imageMimeType} from './textViewerUtils'
import {useNotifications} from '../../NotificationContext'

interface ImageSize {
    width: number
    height: number
}

export default function ImageViewer({sessionId, path, images, onChange, onClose, onDownload}: {
    sessionId: string
    path: string
    images: string[]
    onChange: (path: string) => void
    onClose: () => void
    onDownload: (path: string) => Promise<{message: string; failed: boolean}>
}) {
    const notify = useNotifications()
    const [image, setImage] = useState<{path: string; source: string} | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [downloading, setDownloading] = useState(false)
    const [action, setAction] = useState<{path: string; message: string; failed: boolean} | null>(null)
    const [zoom, setZoom] = useState(1)
    const [imageSize, setImageSize] = useState<ImageSize | null>(null)
    const [viewport, setViewport] = useState<ImageSize>({width: 0, height: 0})
    const dialog = useRef<HTMLDialogElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const imageElement = useRef<HTMLImageElement>(null)
    const id = useId()
    const index = images.indexOf(path)
    const canPrevious = index > 0
    const canNext = index >= 0 && index < images.length - 1

    useEffect(() => {
        dialog.current?.showModal()
    }, [])

    useEffect(() => {
        let cancelled = false
        setError('')
        setLoading(true)
        setImageSize(null)
        setZoom(1)
        const type = imageMimeType(path)
        if (!type) {
            setError('Unsupported image type.')
            notify('Unsupported image type.', 'error')
            setLoading(false)
            return
        }
        void ReadImage(sessionId, path).then(data => {
            if (!cancelled) setImage({path, source: `data:${type};base64,${data}`})
        }).catch(reason => {
            if (!cancelled) {
                const message = `Could not read image: ${String(reason)}`
                setError(message)
                notify(message, 'error')
                setLoading(false)
            }
        })
        return () => { cancelled = true }
    }, [sessionId, path])

    useEffect(() => {
        const element = content.current
        if (!element) return
        const update = () => setViewport({width: element.clientWidth, height: element.clientHeight})
        const observer = new ResizeObserver(update)
        observer.observe(element)
        update()
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const element = dialog.current
        if (!element) return
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey) return
            event.preventDefault()
            const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1)
            setZoom(value => Math.max(0.1, Math.min(8, value * Math.exp(-delta * 0.0015))))
        }
        element.addEventListener('wheel', wheel, {passive: false})
        return () => element.removeEventListener('wheel', wheel)
    }, [])

    const fit = imageSize && viewport.width && viewport.height
        ? Math.min(viewport.width / imageSize.width, viewport.height / imageSize.height, 1)
        : 0
    const dimensions = imageSize && fit
        ? {width: imageSize.width * fit * zoom, height: imageSize.height * fit * zoom}
        : undefined
    const actionMessage = action && (action.path === path
        ? action.message : `${action.path.split('/').pop()}: ${action.message}`)
    const canCopy = !loading && !!imageSize && image?.path === path && !error

    const copyImage = async () => {
        if (!canCopy) return
        setAction(null)
        try {
            const element = imageElement.current
            if (!element || image?.path !== path || !imageSize || loading) {
                throw new Error('Image is not ready.')
            }
            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                throw new Error('Image clipboard access is unavailable.')
            }
            const canvas = document.createElement('canvas')
            canvas.width = element.naturalWidth
            canvas.height = element.naturalHeight
            const context = canvas.getContext('2d')
            if (!context) throw new Error('Could not prepare image.')
            context.drawImage(element, 0, 0)
            const png = new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image.')), 'image/png')
            })
            await navigator.clipboard.write([new ClipboardItem({'image/png': png})])
            setAction({path, message: 'Image copied to clipboard.', failed: false})
            notify('Image copied to clipboard.')
        } catch (reason) {
            const message = `Could not copy image: ${String(reason)}`
            setAction({path, message, failed: true})
            notify(message, 'error')
        }
    }

    const downloadImage = async () => {
        if (downloading) return
        setDownloading(true)
        setAction(null)
        try {
            const result = await onDownload(path)
            setAction({path, ...result})
        } catch (reason) {
            const message = `Download failed: ${String(reason)}`
            setAction({path, message, failed: true})
            notify(message, 'error')
        } finally {
            setDownloading(false)
        }
    }

    return <dialog ref={dialog} className="text-viewer-window" aria-labelledby={`${id}-title`} onClose={onClose}
        onKeyDown={event => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                dialog.current?.close()
                return
            }
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
            if (event.key === 'ArrowLeft' && canPrevious) {
                event.preventDefault()
                onChange(images[index - 1])
            } else if (event.key === 'ArrowRight' && canNext) {
                event.preventDefault()
                onChange(images[index + 1])
            }
        }}>
        <section className="text-viewer">
            <div className="text-viewer-toolbar image-viewer-toolbar">
                <button type="button" className="secondary text-viewer-icon" aria-label="Back to files"
                    title="Back to files" onClick={() => dialog.current?.close()}>←</button>
                <h2 id={`${id}-title`} className="text-viewer-path" title={path}>{path.split('/').pop()}</h2>
                <button type="button" className="secondary" disabled={!canPrevious}
                    onClick={() => onChange(images[index - 1])}>Previous image</button>
                <button type="button" className="secondary" disabled={!canNext}
                    onClick={() => onChange(images[index + 1])}>Next image</button>
                <button type="button" className="secondary" aria-label="Zoom out"
                    onClick={() => setZoom(value => Math.max(0.1, value / 1.25))}>−</button>
                <button type="button" className="secondary" onClick={() => setZoom(1)}
                    aria-label="Reset image zoom">{Math.round(zoom * 100)}%</button>
                <button type="button" className="secondary" aria-label="Zoom in"
                    onClick={() => setZoom(value => Math.min(8, value * 1.25))}>+</button>
                <button type="button" className="secondary" aria-disabled={!canCopy}
                    onClick={() => void copyImage()}>Copy image</button>
                <button type="button" className="secondary" aria-disabled={downloading}
                    onClick={() => void downloadImage()}>Download</button>
                <button type="button" className="secondary text-viewer-icon" aria-label="Close image viewer"
                    title="Close image viewer" onClick={() => dialog.current?.close()}>×</button>
            </div>
            {loading && <div className="text-viewer-meta" role="status">Loading image...</div>}
            {error && <p className="file-browser-error" role="alert">{error}</p>}
            <div className={action && !action.failed ? 'text-viewer-meta' : 'image-viewer-empty-status'}
                role="status">{action && !action.failed ? actionMessage : ''}</div>
            {action?.failed &&
                <div className="file-browser-error text-viewer-meta" role="alert">{actionMessage}</div>}
            <div ref={content} className="image-viewer-content" tabIndex={0} aria-label="Image">
                <div className="image-viewer-frame">
                    {image?.path === path && !error && <img ref={imageElement} key={path} className={dimensions ? 'image-viewer-scaled' : undefined}
                        src={image.source} alt={path.split('/').pop()} style={dimensions}
                        onLoad={event => {
                            setImageSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})
                            setLoading(false)
                        }}
                        onError={() => {
                            setError('Could not display this image.')
                            notify('Could not display this image.', 'error')
                            setLoading(false)
                        }}/>}
                </div>
            </div>
        </section>
    </dialog>
}
