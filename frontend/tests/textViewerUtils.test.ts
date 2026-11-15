import {strict as assert} from 'node:assert'
import {test} from 'node:test'
import {fileIconType, findMatches, formatSize, imageMimeType, includeSelectedMatch, isLogFile, isVideoFile, languageForFile, searchFile} from '../src/plugins/files/textViewerUtils.ts'

test('formats file sizes using the largest appropriate unit', () => {
    assert.equal(formatSize(0), '0 B')
    assert.equal(formatSize(1024), '1 KiB')
    assert.equal(formatSize(1536), '1.5 KiB')
    assert.equal(formatSize(1024 ** 2), '1 MiB')
    assert.equal(formatSize(1024 ** 3), '1 GiB')
    assert.equal(formatSize(1024 ** 2 - 1), '1 MiB')
})

test('search respects case, whole words, Unicode boundaries and literal punctuation', () => {
    const text = 'Error error errors éerror error_ error. C++ c++'
    assert.deepEqual(findMatches(text, 'error', false, true).map(match => match.start), [0, 6, 33])
    assert.deepEqual(findMatches(text, 'Error', true, true).map(match => match.start), [0])
    assert.deepEqual(findMatches(text, 'C++', false, false).map(match => match.start), [40, 44])
    assert.deepEqual(findMatches(text, '', false, false), [])
    assert.deepEqual(findMatches('𐐀test test𐐀 test', 'test', false, true).map(match => match.start), [14])
})

test('recognizes code, configuration and rotated log names', () => {
    assert.equal(languageForFile('/etc/service.conf'), 'ini')
    assert.equal(languageForFile('main.tsx'), 'typescript')
    assert.equal(languageForFile('Dockerfile'), 'dockerfile')
    assert.equal(isLogFile('server.LOG.1'), true)
    assert.equal(isLogFile('catalog.txt'), false)
})

test('identifies file icons by name and provides a generic fallback', () => {
    assert.deepEqual(fileIconType('main.TSX'), {kind: 'code', label: 'TSX'})
    assert.deepEqual(fileIconType('Dockerfile'), {kind: 'code', label: 'DOCKER'})
    assert.deepEqual(fileIconType('server.LOG.1'), {kind: 'log', label: 'LOG'})
    assert.deepEqual(fileIconType('notes.txt'), {kind: 'text', label: 'TXT'})
    assert.deepEqual(fileIconType('.env'), {kind: 'config', label: 'CONF'})
    assert.deepEqual(fileIconType('server.properties'), {kind: 'config', label: 'CONF'})
    assert.deepEqual(fileIconType('picture.png'), {kind: 'file', label: 'PNG'})
    assert.deepEqual(fileIconType('README'), {kind: 'file', label: 'FILE'})
})

test('recognizes image types without mistaking other files for images', () => {
    assert.equal(imageMimeType('/images/photo.JPEG'), 'image/jpeg')
    assert.equal(imageMimeType('diagram.svg'), 'image/svg+xml')
    assert.equal(imageMimeType('notes.txt'), undefined)
    assert.equal(imageMimeType('png'), undefined)
})

test('recognizes video extensions including MPG without mistaking other files', () => {
    for (const name of ['movie.MPG', 'movie.mpeg', 'clip.MP4', 'movie.mkv', 'movie.webm']) {
        assert.equal(isVideoFile(name), true, name)
    }
    for (const name of ['mpg', 'movie.mpg.txt', 'movie.png', 'movie']) {
        assert.equal(isVideoFile(name), false, name)
    }
})

test('streams whole-file matches across chunks with byte offsets, lines and paging', async () => {
    const text = `${'a'.repeat(280)}\néclair ERRor!\nerror_suffix\nERROR\n${'a'.repeat(300)} error end`
    const encoder = new TextEncoder()
    const chunks: {text: string; offset: number; nextOffset: number; size: number}[] = []
    let offset = 0
    const points = Array.from(text)
    while (points.length) {
        const part = points.splice(0, 7).join('')
        const nextOffset = offset + encoder.encode(part).length
        chunks.push({text: part, offset, nextOffset, size: encoder.encode(text).length})
        offset = nextOffset
    }
    const read = async (position: number) => {
        const chunk = chunks.find(item => item.offset === position)
        if (!chunk) throw new Error('Invalid read offset')
        return chunk
    }
    const options = [read, 'error', false, true, offset] as const
    const first = await searchFile(...options, 0, 2, new AbortController().signal, () => {})
    assert.equal(first.total, 3)
    assert.deepEqual(first.results.map(result => result.line), [2, 4])
    assert.equal(first.results[0].offset, encoder.encode(text.slice(0, text.indexOf('ERRor'))).length)
    assert.ok(first.results[0].viewOffset < first.results[0].offset)
    const second = await searchFile(...options, 2, 2, new AbortController().signal, () => {})
    assert.equal(second.total, 3)
    assert.equal(second.results[0].line, 5)
    assert.match(second.results[0].preview, /error end/)
    const exact = await searchFile(read, 'ERROR', true, true, offset, 0, 10, new AbortController().signal, () => {})
    assert.equal(exact.total, 1)
})

test('streaming search rejects changed files and stops when cancelled', async () => {
    const controller = new AbortController()
    await assert.rejects(searchFile(async offset => ({text: 'a', offset, nextOffset: offset + 1, size: 2}),
        'a', false, false, 1, 0, 10, controller.signal, () => {}), /changed/)
    controller.abort()
    await assert.rejects(searchFile(async () => { throw new Error('must not read') },
        'a', false, false, 1, 0, 10, controller.signal, () => {}), {name: 'AbortError'})
})

test('preserves a selected match when a loaded window begins inside a repeated pattern', () => {
    const text = 'a'.repeat(20)
    const selected = {start: 10, end: 13}
    const matches = includeSelectedMatch(findMatches(text, 'aaa', true, false), selected)
    assert.ok(matches.some(match => match.start === 10 && match.end === 13))
    assert.ok(matches.every(match => match.start === 10 || match.end <= 10 || match.start >= 13))
})

test('streamed non-overlapping matches remain aligned across chunk boundaries', async () => {
    const text = 'a'.repeat(1000)
    const read = async (offset: number) => {
        const nextOffset = Math.min(offset + 17, text.length)
        return {text: text.slice(offset, nextOffset), offset, nextOffset, size: text.length}
    }
    const result = await searchFile(read, 'aaa', true, false, text.length, 0, 1000,
        new AbortController().signal, () => {})
    assert.deepEqual(result.results.map(match => match.offset),
        findMatches(text, 'aaa', true, false).map(match => match.start))
})

test('streamed line numbers handle CRLF and CR across chunk boundaries', async () => {
    const text = `${'x'.repeat(210)}\r\nERROR\rERROR\nERROR`
    const read = async (offset: number) => {
        const nextOffset = Math.min(offset + 211, text.length)
        return {text: text.slice(offset, nextOffset), offset, nextOffset, size: text.length}
    }
    const result = await searchFile(read, 'ERROR', true, true, text.length, 0, 10,
        new AbortController().signal, () => {})
    assert.deepEqual(result.results.map(match => match.line), [2, 3, 4])
})
