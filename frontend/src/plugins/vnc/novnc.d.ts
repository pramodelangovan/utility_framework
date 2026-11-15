declare module '@novnc/novnc' {
    interface RFBEvents {
        connect: CustomEvent
        disconnect: CustomEvent<{clean: boolean}>
        credentialsrequired: CustomEvent<{types: string[]}>
        securityfailure: CustomEvent<{status: number; reason?: string}>
        serververification: CustomEvent
    }

    export default class RFB {
        constructor(target: Element, url: string, options?: {credentials?: {password?: string}})
        scaleViewport: boolean
        addEventListener<K extends keyof RFBEvents>(type: K, listener: (event: RFBEvents[K]) => void): void
        disconnect(): void
        sendCredentials(credentials: {password: string}): void
        sendCtrlAltDel(): void
        getImageData(): ImageData
    }
}
