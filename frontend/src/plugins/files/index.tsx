import type {PluginDef} from '../types'
import FileBrowser from './FileBrowser'

const plugin: PluginDef = {
    id: 'files',
    title: 'Remote Files',
    icon: '▤',
    order: 15,
    component: FileBrowser,
}

export default plugin
