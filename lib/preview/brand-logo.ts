// Shared iM Bank logo loader for both ETF and Market preview cards.
// Searches a list of candidate paths so an extension/content mismatch
// (e.g. JPEG bytes saved with .png) still works. Returns a base64
// data URI ready to embed in SVG <image> or HTML <img>.

import * as fs from 'fs'
import * as path from 'path'

const CANDIDATES = [
  'public/im-bank-logo.png',
  'public/im-bank-logo.jpg',
  'public/im-bank-signature-ko.jpg',
]

function detectImageMime(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return 'image/jpeg'
}

/**
 * Loads the iM Bank logo as a base64 data URI. Throws if no candidate
 * file exists — caller may want to fall back to a placeholder.
 */
export function loadBrandLogoDataUri(): string {
  for (const p of CANDIDATES) {
    const abs = path.resolve(process.cwd(), p)
    try {
      const buf = fs.readFileSync(abs)
      const mime = detectImageMime(buf)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Brand logo not found. Place a logo file at one of: ${CANDIDATES.join(', ')}`)
}

/**
 * Same as loadBrandLogoDataUri but returns null instead of throwing.
 * Useful for non-critical render paths.
 */
export function tryLoadBrandLogoDataUri(): string | null {
  try {
    return loadBrandLogoDataUri()
  } catch {
    return null
  }
}
