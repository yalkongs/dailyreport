// lib/json-helpers.ts
import * as fs from 'fs'
import * as path from 'path'

export function loadJson<T>(filePath: string, defaultValue: T): T {
  try {
    const abs = path.join(/* turbopackIgnore: true */ process.cwd(), filePath)
    if (!fs.existsSync(abs)) return defaultValue
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as T
  } catch {
    return defaultValue
  }
}
