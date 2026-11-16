import {createContext, useContext} from 'react'

export interface FullscreenControls {
    activeModuleId: string | undefined
    appFullscreen: boolean
    vncSession: string | null
    sidebarVisible: boolean
    pending: boolean
    error: string
    enterVnc: (id: string) => Promise<void>
    exitVnc: () => void
    toggleSidebar: () => void
}

export const FullscreenContext = createContext<FullscreenControls | null>(null)

export function useFullscreen() {
    const context = useContext(FullscreenContext)
    if (!context) throw new Error('Fullscreen controls are unavailable')
    return context
}
