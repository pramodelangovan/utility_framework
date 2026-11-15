import type {ssh} from '../../../wailsjs/go/models'

export type FileSort = 'name' | 'size' | 'modified' | 'owner'
export type SortDirection = 'ascending' | 'descending'

const nameCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})

export function visibleFileEntries(entries: ssh.FileEntry[], showHidden: boolean, sortBy: FileSort, direction: SortDirection): ssh.FileEntry[] {
    const factor = direction === 'ascending' ? 1 : -1
    return entries.filter(entry => showHidden || !entry.name.startsWith('.')).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        let comparison: number
        switch (sortBy) {
            case 'size': comparison = a.size - b.size; break
            case 'modified': comparison = a.modified < b.modified ? -1 : a.modified > b.modified ? 1 : 0; break
            case 'owner': comparison = nameCollator.compare(a.owner, b.owner); break
            case 'name': comparison = nameCollator.compare(a.name, b.name); break
        }
        return factor * (comparison || nameCollator.compare(a.name, b.name))
    })
}
