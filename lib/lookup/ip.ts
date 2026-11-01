/**
 * IP address helpers for the lookup input router.
 *
 * Pure and dependency-free (the WHATWG `URL` class is the only platform API used), so
 * the same code runs on the server and in the browser.
 */

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

/**
 * Strict dotted-decimal IPv4: four decimal numbers 0-255, no leading zeros.
 * Forms such as "01.2.3.4", "0x7f.1", "127.1" or "2130706433" are rejected on purpose:
 * different software reads them differently (octal, hex, shorthand), which is a classic
 * way to smuggle in loopback or private addresses.
 */
export function isIpv4(value: string): boolean {
    return IPV4.test(value);
}

/** True when the IPv4 address is in public (globally routable) space. */
export function isPublicIpv4(ip: string): boolean {
    const [a, b, c] = ip.split(".").map(Number);

    if (a === 0 || a === 10 || a === 127) return false; // "this network", private, loopback
    if (a >= 224) return false; // multicast, reserved, broadcast
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT (100.64.0.0/10)
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 192.0.0.0/24 and 192.0.2.0/24
    if (a === 192 && b === 88 && c === 99) return false; // deprecated 6to4 relay anycast
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // documentation
    if (a === 203 && b === 0 && c === 113) return false; // documentation
    return true;
}

/**
 * Canonical IPv6 text (lowercase, compressed, no brackets), or null when the input is not
 * a valid IPv6 address. Optional surrounding [brackets] are accepted. Zone identifiers
 * ("fe80::1%eth0") are rejected.
 */
export function normalizeIpv6(input: string): string | null {
    const raw = input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
    if (!raw.includes(":") || !/^[0-9a-fA-F:.]+$/.test(raw)) return null;
    try {
        // The URL parser validates and canonicalizes IPv6 literals for us
        const host = new URL(`http://[${raw}]/`).hostname;
        return host.slice(1, -1);
    } catch {
        return null;
    }
}

/** The eight 16-bit groups of a canonical IPv6 address (as produced by normalizeIpv6). */
function toHextets(canonical: string): number[] {
    const [head, tail] = canonical.split("::");
    const before = head ? head.split(":") : [];
    const after = tail ? tail.split(":") : [];
    const zeros = tail === undefined ? 0 : 8 - before.length - after.length;
    return [...before, ...Array<string>(zeros).fill("0"), ...after].map((group) => parseInt(group, 16));
}

/**
 * True when the canonical IPv6 address is in public space. Only global unicast space
 * (2000::/3) is considered, minus the special-purpose blocks inside it. Everything else
 * (loopback, link-local, unique-local, multicast, IPv4-mapped, NAT64, ...) is not.
 */
export function isPublicIpv6(canonical: string): boolean {
    const h = toHextets(canonical);
    if ((h[0] & 0xe000) !== 0x2000) return false; // not 2000::/3
    if (h[0] === 0x2001 && h[1] < 0x0200) return false; // 2001::/23 IETF special-purpose (Teredo, ORCHID, ...)
    if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // 2001:db8::/32 documentation
    if (h[0] === 0x3fff && (h[1] & 0xf000) === 0) return false; // 3fff::/20 documentation
    if (h[0] === 0x2002) {
        // 6to4 embeds an IPv4 address: judge it by that address
        const embedded = `${h[1] >> 8}.${h[1] & 0xff}.${h[2] >> 8}.${h[2] & 0xff}`;
        return isPublicIpv4(embedded);
    }
    return true;
}
