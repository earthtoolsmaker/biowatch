#!/usr/bin/env node
// One-shot rewriter for the Kruger demo observations.csv: maps raw model
// labels to real scientific names and splits lionfemale into species + sex.
// Usage: node scripts/rewrite-demo-dataset.js <input-csv> <output-csv>

import fs from 'node:fs'
import process from 'node:process'

const MAPPING = {
  impala: { scientificName: 'aepyceros melampus', commonName: 'impala' },
  elephant: { scientificName: 'loxodonta africana', commonName: 'african bush elephant' },
  buffalo: { scientificName: 'syncerus caffer', commonName: 'african buffalo' },
  human: { scientificName: 'homo sapiens', commonName: 'human' },
  zebraburchells: { scientificName: 'equus quagga', commonName: "burchell's zebra" },
  giraffe: { scientificName: 'giraffa camelopardalis', commonName: 'giraffe' },
  kudu: { scientificName: 'tragelaphus strepsiceros', commonName: 'greater kudu' },
  warthog: { scientificName: 'phacochoerus africanus', commonName: 'common warthog' },
  waterbuck: { scientificName: 'kobus ellipsiprymnus', commonName: 'waterbuck' },
  baboon: { scientificName: 'papio ursinus', commonName: 'chacma baboon' },
  birdother: { scientificName: 'aves', commonName: 'bird' },
  hyenaspotted: { scientificName: 'crocuta crocuta', commonName: 'spotted hyena' },
  steenbok: { scientificName: 'raphicerus campestris', commonName: 'steenbok' },
  wildebeestblue: { scientificName: 'connochaetes taurinus', commonName: 'blue wildebeest' },
  hare: { scientificName: 'lepus species', commonName: 'hare' },
  hippopotamus: { scientificName: 'hippopotamus amphibius', commonName: 'hippopotamus' },
  nyala: { scientificName: 'tragelaphus angasii', commonName: 'nyala' },
  dikdik: { scientificName: 'madoqua', commonName: 'dik-dik' },
  duikercommongrey: { scientificName: 'sylvicapra grimmia', commonName: 'common duiker' },
  civet: { scientificName: 'civettictis civetta', commonName: 'african civet' },
  porcupine: { scientificName: 'hystrix africaeaustralis', commonName: 'cape porcupine' },
  lionfemale: { scientificName: 'panthera leo', sex: 'female', commonName: 'lion' },
  leopard: { scientificName: 'panthera pardus', commonName: 'leopard' },
  wilddog: { scientificName: 'lycaon pictus', commonName: 'african wild dog' },
  harespring: { scientificName: 'pedetes capensis', commonName: 'springhare' },
  jackalsidestriped: { scientificName: 'canis adustus', commonName: 'side-striped jackal' },
  rabbitredrock: { scientificName: 'pronolagus rupestris', commonName: 'smith’s red rock rabbit' },
  jackalblackbacked: { scientificName: 'canis mesomelas', commonName: 'black-backed jackal' },
  birdsofprey: { scientificName: 'accipitriformes', commonName: 'bird of prey' },
  caracal: { scientificName: 'caracal caracal', commonName: 'caracal' },
  genetcommonsmallspotted: { scientificName: 'genetta genetta', commonName: 'common genet' },
  monkeyvervet: { scientificName: 'chlorocebus pygerythrus', commonName: 'vervet monkey' },
  reedbuck: { scientificName: 'redunca arundinum', commonName: 'southern reedbuck' },
  serval: { scientificName: 'leptailurus serval', commonName: 'serval' },
  aardvarkantbear: { scientificName: 'orycteropus afer', commonName: 'aardvark' },
  duikerrednatal: { scientificName: 'cephalophus natalensis', commonName: 'red duiker' },
  aardwolf: { scientificName: 'proteles cristata', commonName: 'aardwolf' },
  cheetah: { scientificName: 'acinonyx jubatus', commonName: 'cheetah' },
  crocodile: { scientificName: 'crocodylus niloticus', commonName: 'nile crocodile' },
  foxbateared: { scientificName: 'otocyon megalotis', commonName: 'bat-eared fox' },
  klipspringer: { scientificName: 'oreotragus oreotragus', commonName: 'klipspringer' },
  oribi: { scientificName: 'ourebia ourebi', commonName: 'oribi' },
  rhinoceros: { scientificName: 'ceratotherium simum', commonName: 'white rhinoceros' },
  roan: { scientificName: 'hippotragus equinus', commonName: 'roan antelope' },
  wildcat: { scientificName: 'felis silvestris lybica', commonName: 'african wildcat' }
}

// Lookup common name by scientific name so the script is idempotent
// (can be re-run on already-rewritten CSVs that no longer carry raw labels).
// Keyed on the lowercased scientific name so it matches regardless of case.
const COMMON_NAME_BY_SCIENTIFIC = Object.fromEntries(
  Object.values(MAPPING).map((m) => [m.scientificName.toLowerCase(), m.commonName])
)

function parseCsvLine(line) {
  // Minimal CSV parse: handles quoted fields and embedded commas. The demo's
  // observations.csv has no quoted fields in practice, but guard anyway.
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

function formatCsvField(value) {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function main() {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/rewrite-demo-dataset.js <input-csv> <output-csv>')
    process.exit(1)
  }

  const raw = fs.readFileSync(inputPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const trailingNewline = raw.endsWith('\n')
  if (trailingNewline) lines.pop()

  if (lines.length === 0) {
    console.error('Input CSV is empty')
    process.exit(1)
  }

  const header = parseCsvLine(lines[0])
  const sciIdx = header.indexOf('scientificName')
  const sexIdx = header.indexOf('sex')
  if (sciIdx === -1) {
    console.error('Input CSV missing scientificName column')
    process.exit(1)
  }
  if (sexIdx === -1) {
    console.error('Input CSV missing sex column')
    process.exit(1)
  }

  // Ensure a commonName column exists, inserted right after scientificName.
  let commonIdx = header.indexOf('commonName')
  const addCommonColumn = commonIdx === -1
  if (addCommonColumn) {
    commonIdx = sciIdx + 1
    header.splice(commonIdx, 0, 'commonName')
  }

  const outLines = [header.map(formatCsvField).join(',')]
  const counts = { rewritten: 0, passthrough: 0, unmapped: new Map() }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      outLines.push('')
      continue
    }
    const fields = parseCsvLine(line)
    if (addCommonColumn) {
      fields.splice(commonIdx, 0, '')
    }
    const label = fields[sciIdx]
    const m = MAPPING[label]
    if (m) {
      fields[sciIdx] = m.scientificName
      if (m.sex != null) fields[sexIdx] = m.sex
      fields[commonIdx] = m.commonName
      counts.rewritten++
    } else if (label) {
      // Already-rewritten rows (input has full scientific names) — lowercase scientificName
      // and fill commonName by case-insensitive lookup.
      const key = label.toLowerCase()
      const common = COMMON_NAME_BY_SCIENTIFIC[key]
      if (common) {
        fields[sciIdx] = key
        if (!fields[commonIdx]) fields[commonIdx] = common
        counts.rewritten++
      } else {
        counts.passthrough++
        counts.unmapped.set(label, (counts.unmapped.get(label) || 0) + 1)
      }
    } else {
      counts.passthrough++
    }
    outLines.push(fields.map(formatCsvField).join(','))
  }

  const output = outLines.join('\n') + (trailingNewline ? '\n' : '')
  fs.writeFileSync(outputPath, output)

  console.log(`Rewrote ${counts.rewritten} rows; passed through ${counts.passthrough}`)
  if (counts.unmapped.size > 0) {
    console.warn('Unmapped labels:')
    for (const [label, n] of [...counts.unmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${label}: ${n}`)
    }
  }
}

main()
