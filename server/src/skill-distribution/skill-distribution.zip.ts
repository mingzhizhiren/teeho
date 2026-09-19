import { deflateRawSync, inflateRawSync } from 'node:zlib'

const MAX_ARCHIVE_BYTES = 67_108_864

// 仅支持构建器生成的 ZIP32 普通文件包（Stored / Deflate，无加密、分卷、注释或 ZIP64）。
const ZIP = {
    local: 0x04034b50,
    central: 0x02014b50,
    end: 0x06054b50,
    localSize: 30,
    centralSize: 46,
    endSize: 22,
    version: 20,
    utf8: 0x0800,
    deflate: 8,
    epochDate: 33,
    maxEntries: 1024,
    maxBytes: MAX_ARCHIVE_BYTES,
    byteMask: 0xff,
    byteBits: 8,
    wordBits: 16,
    highByteBits: 24,
    fileTypeMask: 0xf000,
    regularType: 0x8000,
} as const
const CENTRAL = {
    flags: 8,
    method: 10,
    crc: 16,
    packed: 20,
    size: 24,
    name: 28,
    extra: 30,
    comment: 32,
    disk: 34,
    attributes: 38,
    offset: 42,
} as const
const LOCAL = { flags: 6, method: 8, crc: 14, packed: 18, size: 22, name: 26, extra: 28 } as const
const END = {
    disk: 4,
    centralDisk: 6,
    diskCount: 8,
    count: 10,
    size: 12,
    offset: 16,
    comment: 20,
} as const

function requireZip(condition: boolean): void {
    if (!condition) throw new Error('skill_zip_invalid_or_unsupported')
}

function validName(name: string): boolean {
    return (
        name.startsWith('teeho/') &&
        !/[\\:<>"|?*\x00-\x1f\x7f]/u.test(name) &&
        name
            .split('/')
            .every(
                (part) =>
                    part !== '' &&
                    !/[ .]$/u.test(part) &&
                    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu.test(part),
            )
    )
}

function compatibleNames(name: string, previousNames: readonly string[]): boolean {
    const parts = name.split('/')
    return previousNames.every((previousName) => {
        const previous = previousName.split('/')
        for (const [index, part] of parts.entries()) {
            const other = previous[index]
            if (other === undefined) return false
            if (part.toLowerCase() !== other.toLowerCase()) return true
            if (part !== other) return false
        }
        return false
    })
}

function word(value: number): Buffer {
    return Buffer.from([value & ZIP.byteMask, (value >>> ZIP.byteBits) & ZIP.byteMask])
}

function dword(value: number): Buffer {
    return Buffer.from([
        value & ZIP.byteMask,
        (value >>> ZIP.byteBits) & ZIP.byteMask,
        (value >>> ZIP.wordBits) & ZIP.byteMask,
        (value >>> ZIP.highByteBits) & ZIP.byteMask,
    ])
}

interface ZipEntry {
    readonly name: string
    readonly file: File
    readonly next: number
    readonly localEnd: number
}

interface ZipReadState {
    readonly position: number
    readonly total: number
    readonly names: readonly string[]
    readonly entries: readonly (readonly [string, File])[]
    readonly localEnd: number
}

function readEntry(
    bytes: Buffer,
    position: number,
    centralOffset: number,
    expectedLocalOffset: number,
): ZipEntry {
    requireZip(
        position + ZIP.centralSize <= bytes.length - ZIP.endSize &&
            bytes.readUInt32LE(position) === ZIP.central,
    )
    const short = (offset: number): number => bytes.readUInt16LE(position + offset)
    const long = (offset: number): number => bytes.readUInt32LE(position + offset)
    const next =
        position +
        ZIP.centralSize +
        short(CENTRAL.name) +
        short(CENTRAL.extra) +
        short(CENTRAL.comment)
    requireZip(next <= bytes.length - ZIP.endSize && short(CENTRAL.disk) === 0)
    const name = bytes.toString(
        'utf8',
        position + ZIP.centralSize,
        position + ZIP.centralSize + short(CENTRAL.name),
    )
    requireZip(validName(name) && [0, ZIP.utf8].includes(short(CENTRAL.flags)))
    const kind = (long(CENTRAL.attributes) >>> ZIP.wordBits) & ZIP.fileTypeMask
    requireZip(kind === 0 || kind === ZIP.regularType)
    const offset = long(CENTRAL.offset)
    requireZip(
        offset === expectedLocalOffset &&
            offset + ZIP.localSize <= centralOffset &&
            bytes.readUInt32LE(offset) === ZIP.local,
    )
    const localShort = (field: number): number => bytes.readUInt16LE(offset + field)
    const localLong = (field: number): number => bytes.readUInt32LE(offset + field)
    requireZip(
        localShort(LOCAL.flags) === short(CENTRAL.flags) &&
            localShort(LOCAL.method) === short(CENTRAL.method),
    )
    requireZip(
        localLong(LOCAL.crc) === long(CENTRAL.crc) &&
            localLong(LOCAL.packed) === long(CENTRAL.packed) &&
            localLong(LOCAL.size) === long(CENTRAL.size),
    )
    const start = offset + ZIP.localSize + localShort(LOCAL.name) + localShort(LOCAL.extra)
    const localEnd = start + long(CENTRAL.packed)
    requireZip(localEnd <= centralOffset && long(CENTRAL.size) <= ZIP.maxBytes)
    requireZip(
        bytes.toString(
            'utf8',
            offset + ZIP.localSize,
            offset + ZIP.localSize + localShort(LOCAL.name),
        ) === name,
    )
    const packed = bytes.subarray(start, localEnd)
    const method = short(CENTRAL.method)
    requireZip(method === 0 || method === ZIP.deflate)
    const data = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: ZIP.maxBytes })
    requireZip(data.length === long(CENTRAL.size) && Bun.hash.crc32(data) === long(CENTRAL.crc))
    return { name, file: new File([new Uint8Array(data)], name), next, localEnd }
}

/** 读取受控构建 ZIP 并验证长度、CRC 与条目，不向磁盘解压。 */
export function readSkillZip(input: Uint8Array): Map<string, File> {
    const bytes = Buffer.from(input)
    requireZip(bytes.length >= ZIP.endSize && bytes.length <= ZIP.maxBytes)
    const end = bytes.length - ZIP.endSize
    requireZip(bytes.readUInt32LE(end) === ZIP.end && bytes.readUInt16LE(end + END.comment) === 0)
    const count = bytes.readUInt16LE(end + END.count)
    const centralOffset = bytes.readUInt32LE(end + END.offset)
    requireZip(
        count > 0 && count <= ZIP.maxEntries && bytes.readUInt16LE(end + END.diskCount) === count,
    )
    requireZip(
        bytes.readUInt16LE(end + END.disk) === 0 && bytes.readUInt16LE(end + END.centralDisk) === 0,
    )
    requireZip(centralOffset + bytes.readUInt32LE(end + END.size) === end)
    const state = Array.from({ length: count }).reduce<ZipReadState>(
        (previous) => {
            const entry = readEntry(bytes, previous.position, centralOffset, previous.localEnd)
            requireZip(
                compatibleNames(entry.name, previous.names) &&
                    previous.total + entry.file.size <= ZIP.maxBytes,
            )
            return {
                position: entry.next,
                total: previous.total + entry.file.size,
                names: [...previous.names, entry.name],
                entries: [...previous.entries, [entry.name, entry.file] as const],
                localEnd: entry.localEnd,
            }
        },
        {
            position: centralOffset,
            total: 0,
            names: [],
            entries: [],
            localEnd: 0,
        },
    )
    requireZip(state.position === end && state.localEnd === centralOffset)
    return new Map(state.entries)
}

function encodeEntry(name: string, data: Uint8Array, offset: number) {
    requireZip(validName(name) && data.length <= ZIP.maxBytes)
    const encodedName = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data)
    const common = Buffer.concat([
        word(ZIP.version),
        word(ZIP.utf8),
        word(ZIP.deflate),
        word(0),
        word(ZIP.epochDate),
        dword(Bun.hash.crc32(data)),
        dword(packed.length),
        dword(data.length),
        word(encodedName.length),
        word(0),
    ])
    return {
        local: Buffer.concat([dword(ZIP.local), common, encodedName, packed]),
        central: Buffer.concat([
            dword(ZIP.central),
            word(ZIP.version),
            common,
            word(0),
            word(0),
            word(0),
            dword(0),
            dword(offset),
            encodedName,
        ]),
    }
}

/** 用内置 Deflate 和 CRC32 生成 ZIP32，保持服务端无需 Python 或第三方 ZIP 库。 */
export function writeSkillZip(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
    const pairs = Object.entries(entries)
    requireZip(pairs.length > 0 && pairs.length <= ZIP.maxEntries)
    requireZip(pairs.reduce((sum, [, data]) => sum + data.length, 0) <= ZIP.maxBytes)
    const state = pairs.reduce(
        (previous, [name, data]) => {
            const entry = encodeEntry(name, data, previous.offset)
            return {
                offset: previous.offset + entry.local.length,
                locals: [...previous.locals, entry.local],
                centrals: [...previous.centrals, entry.central],
            }
        },
        { offset: 0, locals: [] as Buffer[], centrals: [] as Buffer[] },
    )
    const central = Buffer.concat(state.centrals)
    return Buffer.concat([
        ...state.locals,
        central,
        dword(ZIP.end),
        word(0),
        word(0),
        word(pairs.length),
        word(pairs.length),
        dword(central.length),
        dword(state.offset),
        word(0),
    ])
}
