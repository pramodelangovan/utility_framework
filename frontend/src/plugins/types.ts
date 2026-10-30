import type {ComponentType} from 'react'

// Each plugin folder exports a default PluginDef from its index.tsx.
export interface PluginDef {
    id: string
    title: string
    icon: string
    order?: number
    component: ComponentType
}
