import type {PluginDef} from '../types'
import SSHPlugin from './SSHPlugin'

const plugin: PluginDef = {
    id: 'ssh',
    title: 'SSH',
    icon: '⌨',
    order: 10,
    component: SSHPlugin,
}

export default plugin
