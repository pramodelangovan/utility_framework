import {useEffect, useId, useRef, useState} from 'react'
import {StartHTMLPreview, StopHTMLPreview} from '../../../wailsjs/go/ssh/Service'

export default function HtmlViewer({sessionId, path, onClose, onViewSource}: {
    sessionId: string
    path: string
    onClose: () => void
    onViewSource: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const id = useId()
    const [address, setAddress] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        dialog.current?.showModal()
        let disposed = false
        let preview = ''
        void StartHTMLPreview(sessionId, path).then(result => {
            if (disposed) {
                void StopHTMLPreview(sessionId, result).catch(console.error)
            } else {
                preview = result
                setAddress(result)
            }
        }).catch(reason => {
            if (!disposed) setError(`Could not open HTML preview: ${String(reason)}`)
        })
        return () => {
            disposed = true
            if (preview) void StopHTMLPreview(sessionId, preview).catch(console.error)
        }
    }, [sessionId, path])

    return <dialog ref={dialog} className="text-viewer-window" aria-labelledby={`${id}-title`} onClose={onClose}>
        <section className="text-viewer">
            <div className="text-viewer-toolbar">
                <button type="button" className="secondary text-viewer-icon" aria-label="Back to files"
                    title="Back to files" onClick={() => dialog.current?.close()}>←</button>
                <h2 id={`${id}-title`} className="text-viewer-path" title={path}>{path.split('/').pop()}</h2>
                <button type="button" className="secondary" onClick={onViewSource}>View source</button>
                <button type="button" className="secondary text-viewer-icon" aria-label="Close HTML preview"
                    title="Close HTML preview" onClick={() => dialog.current?.close()}>×</button>
            </div>
            <p className="html-viewer-warning">This preview runs scripts that can access the network and files in this directory. Open only HTML you trust.</p>
            {error && <p className="file-browser-error" role="alert">{error}</p>}
            {!address && !error && <div className="text-viewer-meta" role="status">Loading HTML preview...</div>}
            {address && <iframe className="html-viewer-frame" title={`Preview of ${path.split('/').pop()}`}
                sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" src={address}/>}
        </section>
    </dialog>
}
