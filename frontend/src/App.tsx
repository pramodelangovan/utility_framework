import {useEffect, useState} from 'react'
import {plugins} from './plugins'
import './style.css'

type Theme = 'dark' | 'light'

function App() {
    const [theme, setTheme] = useState<Theme>(
        () => (localStorage.getItem('theme') as Theme) || 'dark'
    )
    const [activeId, setActiveId] = useState(plugins[0]?.id)
    const activePlugin = plugins.find(p => p.id === activeId)

    useEffect(() => {
        document.documentElement.dataset.theme = theme
        localStorage.setItem('theme', theme)
    }, [theme])

    return (
        <div className="app">
            <aside className="sidebar">
                <div className="brand">
                    <span className="logo" aria-hidden="true">◆</span>
                    <span className="brand-name">Utility</span>
                </div>

                <p className="sidebar-label">Available modules</p>
                <nav className="tabs" aria-label="Utility modules">
                    {plugins.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            className={`tab ${p.id === activeId ? 'active' : ''}`}
                            aria-pressed={p.id === activeId}
                            onClick={() => setActiveId(p.id)}
                        >
                            <span className="tab-icon" aria-hidden="true">{p.icon}</span>
                            <span className="tab-title">{p.title}</span>
                        </button>
                    ))}
                </nav>

                <button
                    type="button"
                    className="theme-toggle"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                    {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
                </button>
            </aside>

            <main className="content">
                <header className="workspace-header">
                    <div className="workspace-title">
                        <p className="eyebrow">Utility framework / module</p>
                        <h1>{activePlugin?.title ?? 'Workspace'}</h1>
                    </div>
                    <div className="workspace-status">
                        <span className="status-dot" aria-hidden="true"/>
                        <span>Local workspace</span>
                    </div>
                </header>
                <section className="plugin-content" aria-label={`${activePlugin?.title ?? 'Utility'} workspace`}>
                    {/* Keep plugins mounted so live terminal state survives module switches. */}
                    {plugins.map(p => (
                        <div key={p.id} className="plugin-pane" hidden={p.id !== activeId}>
                            <p.component/>
                        </div>
                    ))}
                </section>
            </main>
        </div>
    )
}

export default App
