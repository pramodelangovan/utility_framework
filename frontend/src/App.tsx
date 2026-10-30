import {useEffect, useState} from 'react'
import {plugins} from './plugins'
import './style.css'

type Theme = 'dark' | 'light'

function App() {
    const [theme, setTheme] = useState<Theme>(
        () => (localStorage.getItem('theme') as Theme) || 'dark'
    )
    const [activeId, setActiveId] = useState(plugins[0]?.id)

    useEffect(() => {
        document.documentElement.dataset.theme = theme
        localStorage.setItem('theme', theme)
    }, [theme])

    return (
        <div className="app">
            <aside className="sidebar">
                <div className="brand">
                    <span className="logo">◆</span>
                    <span className="brand-name">Utility</span>
                </div>

                <nav className="tabs">
                    {plugins.map(p => (
                        <button
                            key={p.id}
                            className={`tab ${p.id === activeId ? 'active' : ''}`}
                            onClick={() => setActiveId(p.id)}
                        >
                            <span className="tab-icon">{p.icon}</span>
                            <span className="tab-title">{p.title}</span>
                        </button>
                    ))}
                </nav>

                <button
                    className="theme-toggle"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                    {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
                </button>
            </aside>

            <main className="content">
                {/* All plugins stay mounted so their state (e.g. live terminals) survives tab switches */}
                {plugins.map(p => (
                    <div key={p.id} className="plugin-pane" hidden={p.id !== activeId}>
                        <p.component/>
                    </div>
                ))}
            </main>
        </div>
    )
}

export default App
