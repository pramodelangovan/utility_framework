import {createContext, useContext} from 'react'

export type NoticeKind = 'success' | 'error'
export const NotificationContext = createContext<((message: string, kind?: NoticeKind) => void) | null>(null)

export function useNotifications() {
    const notify = useContext(NotificationContext)
    if (!notify) throw new Error('Notifications are unavailable')
    return notify
}
