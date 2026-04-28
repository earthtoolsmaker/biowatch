import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import log from './logger.js'

let cache = null

function findChangelogPath() {
  const candidates = [
    path.join(app.getAppPath(), 'CHANGELOG.md'),
    path.join(process.cwd(), 'CHANGELOG.md')
  ]
  return candidates.find((p) => existsSync(p))
}

export function parseChangelog(text) {
  const releases = []
  const headerRegex = /^##\s+\[([^\]]+)\](?:\s*[-–]\s*(.+))?$/
  const sectionRegex = /^###\s+(.+)$/
  const itemRegex = /^[-*]\s+(.+)$/

  let current = null
  let currentSection = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const headerMatch = line.match(headerRegex)
    if (headerMatch) {
      if (current) releases.push(current)
      current = {
        version: headerMatch[1].trim(),
        date: headerMatch[2]?.trim() || null,
        added: [],
        changed: [],
        fixed: []
      }
      currentSection = null
      continue
    }
    if (!current) continue
    const sectionMatch = line.match(sectionRegex)
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase()
      continue
    }
    if (!currentSection) continue
    const itemMatch = line.match(itemRegex)
    if (itemMatch && current[currentSection]) {
      current[currentSection].push(itemMatch[1].trim())
    }
  }
  if (current) releases.push(current)
  return releases
}

export function getRecentReleases(limit = 3) {
  if (cache) return cache.slice(0, limit)

  const file = findChangelogPath()
  if (!file) {
    log.warn('CHANGELOG.md not found in any candidate path')
    cache = []
    return cache
  }

  try {
    const text = readFileSync(file, 'utf-8')
    cache = parseChangelog(text)
    return cache.slice(0, limit)
  } catch (err) {
    log.error('Failed to read CHANGELOG.md:', err)
    cache = []
    return cache
  }
}
