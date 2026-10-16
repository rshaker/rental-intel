/**
 * The site's "photos": generated SVGs, so no photograph of any real place
 * is ever served. Each is a flat scene whose colours and shapes come from a
 * hash of the listing id and photo number, varied enough that a gallery
 * does not repeat itself.
 */

function hash(text: string): number {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
}

export function photoSvg(id: string, n: number, kind: "building" | "home"): string {
    const h = hash(`${id}/${n}`);
    const variant = n % 3; // 0 day, 1 dusk, 2 interior
    // Walls in stone, brick, sage or slate; skies in blue or a warm dusk; ground in greens.
    const hue = [25, 35, 45, 160, 205, 15, 95][h % 7]!;
    const sky = variant === 1 ? `hsl(${20 + (h % 25)} 70% 68%)` : `hsl(${200 + (h % 16)} 60% 66%)`;
    const sky2 = variant === 1 ? `hsl(${300 + (h % 30)} 35% 72%)` : `hsl(${205 + (h % 10)} 55% 88%)`;
    const wall = `hsl(${hue} ${hue < 100 ? 32 : 18}% ${variant === 1 ? 42 : 60}%)`;
    const trim = `hsl(${hue} ${hue < 100 ? 28 : 16}% ${variant === 1 ? 30 : 42}%)`;
    const ground = `hsl(${95 + (h % 30)} 32% ${variant === 1 ? 32 : 42}%)`;
    const glow = variant === 1 ? `hsl(45 90% 78%)` : `hsl(205 60% 86%)`;
    const parts: string[] = [];
    parts.push(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>`);
    if (variant === 2) {
        // An interior: a wall, a big window onto the sky, a floor.
        parts.push(`<rect width="1200" height="800" fill="hsl(${hue} 22% 90%)"/>`);
        parts.push(`<rect x="0" y="600" width="1200" height="200" fill="hsl(${30 + (h % 15)} 38% 58%)"/>`);
        const wx = 200 + (h % 300);
        parts.push(`<rect x="${wx}" y="120" width="440" height="400" fill="url(#s)" stroke="${trim}" stroke-width="18"/>`);
        parts.push(`<line x1="${wx + 220}" y1="120" x2="${wx + 220}" y2="520" stroke="${trim}" stroke-width="12"/>`);
        parts.push(`<rect x="${wx + 520}" y="380" width="260" height="220" rx="18" fill="${wall}"/>`);
        return wrap(parts);
    }
    parts.push(`<rect width="1200" height="800" fill="url(#s)"/>`);
    parts.push(`<rect x="0" y="640" width="1200" height="160" fill="${ground}"/>`);
    if (kind === "building") {
        const floors = 4 + (h % 5);
        const width = 520 + (h % 300);
        const x = 600 - width / 2;
        const top = 640 - floors * 84;
        parts.push(`<rect x="${x}" y="${top}" width="${width}" height="${floors * 84}" fill="${wall}"/>`);
        const cols = Math.floor(width / 90);
        for (let f = 0; f < floors; f++) {
            for (let c = 0; c < cols; c++) {
                const lit = ((h >> ((f * cols + c) % 31)) & 1) === 1;
                parts.push(`<rect x="${x + 30 + c * 90}" y="${top + 18 + f * 84}" width="46" height="50" fill="${lit ? glow : trim}"/>`);
            }
        }
    } else {
        const w = 540 + (h % 160);
        const x = 600 - w / 2;
        parts.push(`<rect x="${x}" y="360" width="${w}" height="280" fill="${wall}"/>`);
        parts.push(`<polygon points="${x - 40},360 600,200 ${x + w + 40},360" fill="${trim}"/>`);
        parts.push(`<rect x="${600 - 40}" y="480" width="80" height="160" fill="${trim}"/>`);
        parts.push(`<rect x="${x + 60}" y="420" width="110" height="100" fill="${sky2}" stroke="${trim}" stroke-width="8"/>`);
        parts.push(`<rect x="${x + w - 170}" y="420" width="110" height="100" fill="${sky2}" stroke="${trim}" stroke-width="8"/>`);
        parts.push(`<circle cx="${x - 80}" cy="520" r="110" fill="hsl(${110 + (h % 25)} 35% 36%)"/>`);
    }
    return wrap(parts);
}

function wrap(parts: string[]): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">${parts.join("")}</svg>`;
}
