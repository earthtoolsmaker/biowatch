/**
 * Date parsing utilities for OCR-extracted timestamps from camera trap images
 * Supports various date formats including 12-hour (AM/PM) and 24-hour time
 */

import { DateTime } from 'luxon'
import log from 'electron-log'

/**
 * Common date patterns found in camera trap images
 * Each pattern has: regex, parser function, and format description
 */
const DATE_PATTERNS = [
  // ISO format with 12-hour time: 2024-03-20 02:32:15 PM
  {
    regex: /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i,
    parse: (m) => {
      let hour = parseInt(m[4])
      const isPM = m[7].toUpperCase() === 'PM'
      if (isPM && hour !== 12) hour += 12
      if (!isPM && hour === 12) hour = 0
      return {
        year: parseInt(m[1]),
        month: parseInt(m[2]),
        day: parseInt(m[3]),
        hour,
        minute: parseInt(m[5]),
        second: parseInt(m[6] || '0')
      }
    },
    format: 'YYYY-MM-DD hh:mm:ss A'
  },
  // ISO format with 24-hour time: 2024-03-20 14:32:15
  {
    regex: /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: parseInt(m[1]),
      month: parseInt(m[2]),
      day: parseInt(m[3]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'YYYY-MM-DD HH:mm:ss'
  },
  // US format with 12-hour time: 03/20/24 02:32:15 PM or 03/20/2024 02:32:15 PM
  {
    regex: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i,
    parse: (m) => {
      let hour = parseInt(m[4])
      const isPM = m[7].toUpperCase() === 'PM'
      if (isPM && hour !== 12) hour += 12
      if (!isPM && hour === 12) hour = 0
      return {
        year: normalizeYear(parseInt(m[3])),
        month: parseInt(m[1]),
        day: parseInt(m[2]),
        hour,
        minute: parseInt(m[5]),
        second: parseInt(m[6] || '0')
      }
    },
    format: 'MM/DD/YY hh:mm:ss A'
  },
  // US format with 24-hour time: 03/20/24 14:32:15 or 03/20/2024 14:32:15
  {
    regex: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[3])),
      month: parseInt(m[1]),
      day: parseInt(m[2]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'MM/DD/YY HH:mm:ss'
  },
  // US format with dash and 24-hour time: 09-14-2015 20:25:12
  {
    regex: /(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[3])),
      month: parseInt(m[1]),
      day: parseInt(m[2]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'MM-DD-YY HH:mm:ss'
  },
  // EU format with dash: 20-03-2024 14:32 or 20-03-24 14:32
  // Note: Only matches when US interpretation fails (e.g., day > 12 like 20-03-2024)
  {
    regex: /(\d{1,2})-(\d{1,2})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[3])),
      month: parseInt(m[2]),
      day: parseInt(m[1]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'DD-MM-YY HH:mm:ss'
  },
  // EU format with dot: 20.03.2024 14:32
  {
    regex: /(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[3])),
      month: parseInt(m[2]),
      day: parseInt(m[1]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'DD.MM.YY HH:mm:ss'
  },
  // Time-first EU format: 19:11 21/10/19 (HH:mm DD/MM/YY)
  {
    regex: /(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[6])),
      month: parseInt(m[5]),
      day: parseInt(m[4]),
      hour: parseInt(m[1]),
      minute: parseInt(m[2]),
      second: parseInt(m[3] || '0')
    }),
    format: 'HH:mm DD/MM/YY'
  },
  // Text month format: 20-Mar-2024 14:32 or 20 Mar 2024 14:32
  {
    regex:
      /(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*[APap][Mm])/,
    parse: (m) => ({
      year: normalizeYear(parseInt(m[3])),
      month: parseMonthName(m[2]),
      day: parseInt(m[1]),
      hour: parseInt(m[4]),
      minute: parseInt(m[5]),
      second: parseInt(m[6] || '0')
    }),
    format: 'DD-Mon-YYYY HH:mm:ss'
  },
  // Text month with AM/PM: 20-Mar-2024 02:32 PM
  {
    regex:
      /(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i,
    parse: (m) => {
      let hour = parseInt(m[4])
      const isPM = m[7].toUpperCase() === 'PM'
      if (isPM && hour !== 12) hour += 12
      if (!isPM && hour === 12) hour = 0
      return {
        year: normalizeYear(parseInt(m[3])),
        month: parseMonthName(m[2]),
        day: parseInt(m[1]),
        hour,
        minute: parseInt(m[5]),
        second: parseInt(m[6] || '0')
      }
    },
    format: 'DD-Mon-YYYY hh:mm:ss A'
  }
]

/**
 * Month name to number mapping
 */
const MONTH_NAMES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/**
 * Parse month name to number
 * @param {string} name - 3-letter month abbreviation
 * @returns {number} Month number (1-12) or 0 if invalid
 */
function parseMonthName(name) {
  return MONTH_NAMES[name.toLowerCase()] || 0
}

/**
 * Normalize 2-digit year to 4-digit year
 * Assumes years 00-50 are 2000-2050, 51-99 are 1951-1999
 * @param {number} year - 2 or 4 digit year
 * @returns {number} 4-digit year
 */
function normalizeYear(year) {
  if (year < 100) {
    return year <= 50 ? 2000 + year : 1900 + year
  }
  return year
}

/**
 * Check if a date is within a reasonable range for camera trap images
 * @param {number} year - Full year
 * @param {number} month - Month (1-12)
 * @param {number} day - Day of month
 * @returns {boolean} True if date is reasonable
 */
function isReasonableDate(year, month, day) {
  // Year must be between 2000 and 2030
  if (year < 2000 || year > 2030) return false
  // Month must be 1-12
  if (month < 1 || month > 12) return false
  // Day must be valid for the month
  const daysInMonth = new Date(year, month, 0).getDate()
  if (day < 1 || day > daysInMonth) return false
  return true
}

/**
 * Check if time values are valid
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @param {number} second - Second (0-59)
 * @returns {boolean} True if time is valid
 */
function isValidTime(hour, minute, second) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
}

/**
 * Normalize OCR text by removing common artifacts
 * @param {string} text - Raw OCR text
 * @returns {string} Cleaned text
 */
export function normalizeOCRText(text) {
  return (
    text
      // Remove common OCR artifacts
      .replace(/[|[\]{}]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove leading/trailing whitespace
      .trim()
  )
}

/**
 * Parse a date from OCR text
 * @param {string} text - OCR extracted text
 * @returns {Object|null} Parsed result or null if no valid date found
 *   - date: DateTime object
 *   - isoString: ISO 8601 string
 *   - format: Matched format description
 *   - confidence: Confidence score (0-1)
 *   - rawMatch: Original matched text
 */
export function parseDateFromText(text) {
  const normalized = normalizeOCRText(text)
  log.debug(`[DateParser] Normalized text: "${normalized}"`)

  for (const pattern of DATE_PATTERNS) {
    const match = normalized.match(pattern.regex)
    if (match) {
      log.debug(`[DateParser] Pattern "${pattern.format}" matched: "${match[0]}"`)
      try {
        const parsed = pattern.parse(match)
        log.debug(
          `[DateParser] Parsed components: year=${parsed.year}, month=${parsed.month}, day=${parsed.day}, hour=${parsed.hour}, min=${parsed.minute}, sec=${parsed.second}`
        )

        // Validate date components
        if (!isReasonableDate(parsed.year, parsed.month, parsed.day)) {
          log.debug(`[DateParser] Rejected: date not reasonable (year 2000-2030, valid month/day)`)
          continue
        }
        if (!isValidTime(parsed.hour, parsed.minute, parsed.second)) {
          log.debug(`[DateParser] Rejected: invalid time components`)
          continue
        }

        // Create DateTime object
        const dt = DateTime.fromObject({
          year: parsed.year,
          month: parsed.month,
          day: parsed.day,
          hour: parsed.hour,
          minute: parsed.minute,
          second: parsed.second
        })

        if (!dt.isValid) {
          log.debug(`[DateParser] Rejected: DateTime invalid - ${dt.invalidReason}`)
          continue
        }

        log.debug(`[DateParser] Success: ${dt.toISO()}`)
        return {
          date: dt,
          isoString: dt.toISO(),
          format: pattern.format,
          confidence: 0.9, // High confidence for regex match with valid components
          rawMatch: match[0]
        }
      } catch (err) {
        // Parsing failed, try next pattern
        log.debug(`[DateParser] Pattern "${pattern.format}" parse error: ${err.message}`)
        continue
      }
    }
  }

  log.debug(`[DateParser] No patterns matched`)
  return null
}

/**
 * Extract all potential date strings from text
 * @param {string} text - OCR extracted text
 * @returns {Array<Object>} Array of parsed dates, sorted by confidence
 */
export function extractAllDates(text) {
  const normalized = normalizeOCRText(text)
  const results = []

  for (const pattern of DATE_PATTERNS) {
    // Use matchAll to find all occurrences
    const matches = [...normalized.matchAll(new RegExp(pattern.regex, 'gi'))]

    for (const match of matches) {
      try {
        const parsed = pattern.parse(match)

        if (!isReasonableDate(parsed.year, parsed.month, parsed.day)) {
          continue
        }
        if (!isValidTime(parsed.hour, parsed.minute, parsed.second)) {
          continue
        }

        const dt = DateTime.fromObject({
          year: parsed.year,
          month: parsed.month,
          day: parsed.day,
          hour: parsed.hour,
          minute: parsed.minute,
          second: parsed.second
        })

        if (dt.isValid) {
          results.push({
            date: dt,
            isoString: dt.toISO(),
            format: pattern.format,
            confidence: 0.9,
            rawMatch: match[0]
          })
        }
      } catch {
        continue
      }
    }
  }

  // Sort by confidence (descending)
  return results.sort((a, b) => b.confidence - a.confidence)
}
