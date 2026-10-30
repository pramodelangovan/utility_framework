import type {PluginDef} from './types'

// Auto-discovers every src/plugins/<name>/index.tsx. Adding a folder adds a sidebar tab.
const modules = import.meta.glob<{ default: PluginDef }>('./*/index.tsx', {eager: true})

export const plugins: PluginDef[] = Object.values(modules)
    .map(m => m.default)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title))
