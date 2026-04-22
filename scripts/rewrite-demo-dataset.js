#!/usr/bin/env node
// One-shot rewriter for the Kruger demo observations.csv: maps raw model
// labels to real scientific names and splits lionfemale into species + sex.
// Usage: node scripts/rewrite-demo-dataset.js <input-csv> <output-csv>

import fs from 'node:fs'
import process from 'node:process'

const MAPPING = {
  impala: { scientificName: 'Aepyceros melampus' },
  elephant: { scientificName: 'Loxodonta africana' },
  buffalo: { scientificName: 'Syncerus caffer' },
  human: { scientificName: 'Homo sapiens' },
  zebraburchells: { scientificName: 'Equus quagga' },
  giraffe: { scientificName: 'Giraffa camelopardalis' },
  kudu: { scientificName: 'Tragelaphus strepsiceros' },
  warthog: { scientificName: 'Phacochoerus africanus' },
  waterbuck: { scientificName: 'Kobus ellipsiprymnus' },
  baboon: { scientificName: 'Papio ursinus' },
  birdother: { scientificName: 'Aves' },
  hyenaspotted: { scientificName: 'Crocuta crocuta' },
  steenbok: { scientificName: 'Raphicerus campestris' },
  wildebeestblue: { scientificName: 'Connochaetes taurinus' },
  hare: { scientificName: 'Lepus species' },
  hippopotamus: { scientificName: 'Hippopotamus amphibius' },
  nyala: { scientificName: 'Tragelaphus angasii' },
  dikdik: { scientificName: 'Madoqua' },
  duikercommongrey: { scientificName: 'Sylvicapra grimmia' },
  civet: { scientificName: 'Civettictis civetta' },
  porcupine: { scientificName: 'Hystrix africaeaustralis' },
  lionfemale: { scientificName: 'Panthera leo', sex: 'female' },
  leopard: { scientificName: 'Panthera pardus' },
  wilddog: { scientificName: 'Lycaon pictus' },
  harespring: { scientificName: 'Pedetes capensis' },
  jackalsidestriped: { scientificName: 'Canis adustus' },
  rabbitredrock: { scientificName: 'Pronolagus rupestris' },
  jackalblackbacked: { scientificName: 'Canis mesomelas' },
  birdsofprey: { scientificName: 'Accipitriformes' },
  caracal: { scientificName: 'Caracal caracal' },
  genetcommonsmallspotted: { scientificName: 'Genetta genetta' },
  monkeyvervet: { scientificName: 'Chlorocebus pygerythrus' },
  reedbuck: { scientificName: 'Redunca arundinum' },
  serval: { scientificName: 'Leptailurus serval' },
  aardvarkantbear: { scientificName: 'Orycteropus afer' },
  duikerrednatal: { scientificName: 'Cephalophus natalensis' },
  aardwolf: { scientificName: 'Proteles cristata' },
  cheetah: { scientificName: 'Acinonyx jubatus' },
  crocodile: { scientificName: 'Crocodylus niloticus' },
  foxbateared: { scientificName: 'Otocyon megalotis' },
  klipspringer: { scientificName: 'Oreotragus oreotragus' },
  oribi: { scientificName: 'Ourebia ourebi' },
  rhinoceros: { scientificName: 'Ceratotherium simum' },
  roan: { scientificName: 'Hippotragus equinus' },
  wildcat: { scientificName: 'Felis silvestris lybica' }
}

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

  const outLines = [lines[0]]
  const counts = { rewritten: 0, passthrough: 0, unmapped: new Map() }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      outLines.push('')
      continue
    }
    const fields = parseCsvLine(line)
    const label = fields[sciIdx]
    const m = MAPPING[label]
    if (m) {
      fields[sciIdx] = m.scientificName
      if (m.sex != null) fields[sexIdx] = m.sex
      counts.rewritten++
    } else if (label) {
      counts.passthrough++
      counts.unmapped.set(label, (counts.unmapped.get(label) || 0) + 1)
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
