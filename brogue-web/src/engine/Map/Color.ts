/**
 * src/engine/Map/Color.ts
 * Replicates Brogue's RGB color arithmetic and blending routines
 */

export interface RGBA {
    r: number;
    g: number;
    b: number;
    a?: number;
}

export class ColorUtils {
    /**
     * Parse a hex color string like '#ff00aa' or 'ff00aa' or 0xff00aa into RGBA (0-100 scale to match Brogue, or 0-255)
     * For PixiJS compatibility, we'll keep internal math 0-255, and export to hex string.
     */
    static hexToRGB(hex: string | number): RGBA {
        let h = typeof hex === 'string' ? hex.replace('#', '') : hex.toString(16).padStart(6, '0');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const num = parseInt(h, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    /** Convert RGB 0-255 back to hex string '#rrggbb' */
    static rgbToHex(color: RGBA): string {
        const toHex = (n: number) => Math.max(0, Math.min(255, Math.floor(n))).toString(16).padStart(2, '0');
        return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
    }

    /** Additive Blending (Light accumulation): result = min(255, a + b) */
    static add(a: RGBA, b: RGBA, percent: number = 100): RGBA {
        const p = percent / 100;
        return {
            r: Math.min(255, a.r + b.r * p),
            g: Math.min(255, a.g + b.g * p),
            b: Math.min(255, a.b + b.b * p)
        };
    }

    /** Multiply Blending (Ambient shading): result = a * b / 255 */
    static multiply(a: RGBA, b: RGBA): RGBA {
        return {
            r: Math.floor((a.r * b.r) / 255),
            g: Math.floor((a.g * b.g) / 255),
            b: Math.floor((a.b * b.b) / 255)
        };
    }

    /** Mix two colors. percent = 100 means fully color B. */
    static mix(a: RGBA, b: RGBA, percent: number): RGBA {
        const p = Math.max(0, Math.min(100, percent)) / 100;
        const inv = 1 - p;
        return {
            r: Math.floor(a.r * inv + b.r * p),
            g: Math.floor(a.g * inv + b.g * p),
            b: Math.floor(a.b * inv + b.b * p)
        };
    }
}
