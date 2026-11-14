import type {PluginDef} from '../types'
import VNCPlugin from './VNCPlugin'

const plugin: PluginDef = {
    id: 'vnc',
    title: 'VNC',
    icon: '▣',
    order: 20,
    component: VNCPlugin,
}

export default plugin
