import {strict as assert} from 'node:assert'
import {test} from 'node:test'
import {visibleFileEntries} from '../src/plugins/files/fileBrowserUtils.ts'
import {matchingFileNames} from '../src/plugins/files/textViewerUtils.ts'
import type {ssh} from '../wailsjs/go/models'

const entry = (name: string, isDir: boolean, size: number, modified: string, owner: string): ssh.FileEntry =>
    ({name, isDir, size, modified, owner, permissions: ''})

const entries = [
    entry('file10', false, 2, '2025-01-01 00:00:00', 'zoe'),
    entry('.secret', false, 50, '2026-01-01 00:00:00', 'amy'),
    entry('file2', false, 100, '2024-01-01 00:00:00', 'bob'),
    entry('.folder', true, 5, '2025-01-01 00:00:00', 'zoe'),
    entry('folder', true, 10, '2024-01-01 00:00:00', 'amy'),
]

test('hidden files and folders are filtered unless explicitly shown', () => {
    assert.deepEqual(visibleFileEntries(entries, false, 'name', 'ascending').map(item => item.name),
        ['folder', 'file2', 'file10'])
    assert.deepEqual(visibleFileEntries(entries, true, 'name', 'ascending').map(item => item.name),
        ['.folder', 'folder', '.secret', 'file2', 'file10'])
    assert.equal(entries.length, 5)
})

test('sorts by raw size, modification time, and owner in either direction with folders first', () => {
    assert.deepEqual(visibleFileEntries(entries, true, 'size', 'descending').map(item => item.name),
        ['folder', '.folder', 'file2', '.secret', 'file10'])
    assert.deepEqual(visibleFileEntries(entries, false, 'modified', 'ascending').map(item => item.name),
        ['folder', 'file2', 'file10'])
    assert.deepEqual(visibleFileEntries(entries, true, 'owner', 'ascending').map(item => item.name),
        ['folder', '.folder', '.secret', 'file2', 'file10'])
    assert.deepEqual(visibleFileEntries(entries, false, 'name', 'descending').map(item => item.name),
        ['folder', 'file10', 'file2'])
})

test('finds literal, case-insensitive names only among visible entries', () => {
    const visible = visibleFileEntries(entries, false, 'name', 'ascending')
    assert.deepEqual(matchingFileNames(visible, 'FILE'), ['file2', 'file10'])
    assert.deepEqual(matchingFileNames(visible, '.'), [])
    assert.deepEqual(matchingFileNames(visibleFileEntries(entries, true, 'name', 'ascending'), '.'),
        ['.folder', '.secret'])
    assert.deepEqual(matchingFileNames(visible, ''), [])
    assert.deepEqual(matchingFileNames(visible, 'missing'), [])
})
