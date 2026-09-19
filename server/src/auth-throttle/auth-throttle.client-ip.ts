import { isIP } from 'node:net'

const ipv4Loopback = '127.0.0.1'
const ipv6Loopback = '::1'
const ipv4MappedLoopback = '::ffff:127.0.0.1'
const ipv6HextetRadix = 16
const ipv6HextetWidth = 4
const ipv6PrefixHextetCount = 4
const maximumIpv6Halves = 2
const ipv6HextetCount = 8
const ipv4Version = 4
const ipv6Version = 6

type RuntimeEnvironment = 'development' | 'test' | 'production'

function isLoopbackAddress(address: string) {
    return [ipv4Loopback, ipv6Loopback, ipv4MappedLoopback].includes(address)
}

function expandIpv6(address: string) {
    const normalized = address.toLowerCase().split('%')[0] ?? ''
    const halves = normalized.split('::')
    if (halves.length > maximumIpv6Halves) return null

    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const omitted = ipv6HextetCount - left.length - right.length
    if (omitted < 0 || (halves.length === 1 && omitted !== 0)) return null

    const parts =
        halves.length === maximumIpv6Halves
            ? [...left, ...Array<string>(omitted).fill('0'), ...right]
            : left
    if (parts.length !== ipv6HextetCount) return null

    return parts.map((part) =>
        Number.parseInt(part || '0', ipv6HextetRadix)
            .toString(ipv6HextetRadix)
            .padStart(ipv6HextetWidth, '0'),
    )
}

function normalizeIpAddress(address: string) {
    const candidate = address.trim()
    const version = isIP(candidate)
    if (version === ipv4Version) return candidate
    if (version !== ipv6Version) return null

    const parts = expandIpv6(candidate)
    if (!parts) return null
    return `${parts.slice(0, ipv6PrefixHextetCount).join(':')}::/64`
}

/** 从网络连接和受信任的本机 Nginx 请求头解析登录来源地址。 */
export function readLoginClientIp(
    headers: Headers,
    socketAddress: string,
    environment: RuntimeEnvironment,
) {
    const directAddress = normalizeIpAddress(socketAddress)
    if (environment === 'production' && directAddress && isLoopbackAddress(socketAddress.trim())) {
        return normalizeIpAddress(headers.get('x-real-ip') ?? '') ?? directAddress
    }

    return directAddress
}
