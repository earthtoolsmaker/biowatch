import fs from 'fs'
import path from 'path'
import os from 'os'
import { Transform } from 'stream'
import { DateTime } from 'luxon'
import {
  getStudyDatabase,
  deployments,
  media,
  observations,
  insertMetadata
} from '../../../database/index.js'
import { downloadFileWithRetry, extractZip } from '../../download.ts'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick.js'
import { streamArray } from 'stream-json/streamers/StreamArray.js'
import { chain } from 'stream-chain'
import log from '../../logger.js'
import { getBiowatchDataPath } from '../../paths.js'
import { DEFAULT_SEQUENCE_GAP } from '../../../../shared/constants.js'

/**
 * Whitelisted LILA datasets with their metadata and access URLs
 * Images are loaded via HTTP at runtime from Azure Blob Storage
 */
export const LILA_DATASETS = [
  {
    id: 'biome-health-maasai-mara-2018',
    name: 'Biome Health Project Maasai Mara 2018',
    description: 'Wildlife monitoring dataset from Maasai Mara ecosystem, Kenya (2018)',
    longDescription:
      '37,075 images from the WWF-UK/UCL Biome Health Project site in the Maasai Mara, Kenya. Labels for 100 categories including wild mammals, wild birds, and domestic mammals. Created by labeling one image per five-minute period across 176 camera sites.',
    citation:
      'Connolly E, Pringle HA, Pantazis O, et al (2025). Sustainable cattle management by communities supports African wildlife. bioRxiv.',
    organization: 'University College London',
    contactEmail: null,
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/biome-health-project-maasai-mara-2018/biome-health-project-maasai-mara-2018.json',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/biome-health-project-maasai-mara-2018/',
    isZipped: false,
    imageCount: 37075,
    categoryCount: 100
  },
  {
    id: 'snapshot-karoo',
    name: 'Snapshot Karoo',
    description: 'Wildlife from Karoo National Park, South Africa',
    longDescription:
      "This data set contains 14889 sequences of camera trap images, totaling 38074 images, from the Snapshot Karoo project located in South Africa's Karoo National Park (Nama Karoo biome). The dataset captures wildlife across 38 species categories.",
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'huebn090@umn.edu',
    metadataUrl:
      'https://storage.googleapis.com/public-datasets-lila/snapshot-safari/KAR/SnapshotKaroo_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KAR/KAR_public/',
    isZipped: true,
    imageCount: 38074,
    categoryCount: 38
  },
  {
    id: 'ena24-detection',
    name: 'ENA24 Detection',
    description: 'Eastern North America camera traps with bounding boxes (23 species)',
    longDescription:
      'Approximately 10,000 camera trap images representing 23 classes from Eastern North America, with bounding boxes on each image. Most common classes include American Crow, American Black Bear, and Dog.',
    citation:
      'Yousif H, Kays R, Zhihai H (2019). Dynamic Programming Selection of Object Proposals for Sequence-Level Animal Species Classification in the Wild. IEEE Transactions on Circuits and Systems for Video Technology.',
    organization: 'University of Missouri',
    contactEmail: 'hyypp5@mail.missouri.edu',
    metadataUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/ena24/ena24.json',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/ena24/images/',
    isZipped: false,
    imageCount: 10000,
    categoryCount: 23
  },
  {
    id: 'caltech-camera-traps',
    name: 'Caltech Camera Traps',
    description: 'Wildlife from Southwestern United States (21 species, 243K images)',
    longDescription:
      '243,100 images from 140 camera locations across the Southwestern United States. Includes labels for 21 animal categories plus empty images (approximately 70% labeled empty), with roughly 66,000 bounding box annotations.',
    citation:
      'Beery S, Van Horn G, Perona P (2018). Recognition in Terra Incognita. Proceedings of the European Conference on Computer Vision (ECCV).',
    organization: 'Caltech',
    contactEmail: 'caltechcameratraps@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/caltechcameratraps/labels/caltech_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/caltech-unzipped/cct_images/',
    isZipped: true,
    imageCount: 243100,
    categoryCount: 21
  },
  {
    id: 'missouri-camera-traps',
    name: 'Missouri Camera Traps',
    description: 'Wildlife from Missouri, USA (20 species, 25K images)',
    longDescription:
      'Approximately 25,000 camera trap images representing 20 species, including red deer, mouflon, and white-tailed deer. Contains around 900 bounding boxes across challenging sequences with cluttered, dynamic scenes.',
    citation:
      'Zhang Z, He Z, Cao G, Cao W (2016). Animal detection from highly cluttered natural scenes using spatiotemporal object region proposals and patch verification. IEEE Transactions on Multimedia, 18(10), 2079-2092.',
    organization: 'University of Missouri',
    contactEmail: 'info@lila.science',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/missouricameratraps/missouri_camera_traps_set1_1.21.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/missouricameratraps/images/',
    isZipped: true,
    imageCount: 25000,
    categoryCount: 20
  },
  {
    id: 'nacti',
    name: 'North American Camera Trap Images',
    description: 'Wildlife from 5 US locations (28 species, 3.7M images)',
    longDescription:
      '3.7 million camera trap images from five U.S. locations with species-level labels for 28 animal categories. Approximately 12% of images are labeled as empty. Includes bounding box annotations for approximately 8,900 images.',
    citation:
      'Tabak MA, Norouzzadeh MS, Wolfson DW, et al (2019). Machine learning to classify animal species in camera trap images: Applications in ecology. Methods in Ecology and Evolution, 10(4), 585-590.',
    organization: 'US Department of Agriculture',
    contactEmail: 'northamericancameratrapimages@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nacti/nacti_metadata.1.14.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/nacti-unzipped/',
    isZipped: true,
    imageCount: 3700000,
    categoryCount: 28
  },
  {
    id: 'wcs-camera-traps',
    name: 'WCS Camera Traps',
    description: 'Wildlife Conservation Society data from 12 countries (675 species, 1.4M images)',
    longDescription:
      'Approximately 1.4 million camera trap images representing around 675 species from 12 countries. Includes ~375,000 bounding box annotations across ~300,000 images. Approximately 50% of images are empty.',
    citation: null,
    organization: 'Wildlife Conservation Society',
    contactEmail: 'info@lila.science',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wcs/wcs_camera_traps.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/wcs-unzipped/',
    isZipped: true,
    imageCount: 1400000,
    categoryCount: 675
  },
  {
    id: 'wellington-camera-traps',
    name: 'Wellington Camera Traps',
    description: 'Wildlife from Wellington, New Zealand (270K images)',
    longDescription:
      '270,450 images from 187 camera locations across Wellington, New Zealand. Cameras recorded three-image sequences when triggered, classified into 17 categories by citizen scientists and professional ecologists.',
    citation:
      'Anton V, Hartley S, Geldenhuis A, Wittmer HU (2018). Monitoring the mammalian fauna of urban areas using remote cameras and citizen science. Journal of Urban Ecology, 4(1).',
    organization: 'University of Wellington',
    contactEmail: 'vykanton@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wellingtoncameratraps/wellington_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/wellington-unzipped/images/',
    isZipped: true,
    imageCount: 270450,
    categoryCount: 17
  },
  {
    id: 'island-conservation-camera-traps',
    name: 'Island Conservation Camera Traps',
    description: 'Invasive species detection on islands (123K images, bboxes available)',
    longDescription:
      'Approximately 123,000 camera trap images from 123 locations across 7 islands in 6 countries. Focuses on detecting invasive vertebrate species. Includes roughly 65,000 bounding box annotations for about 50,000 images.',
    citation: null,
    organization: 'Island Conservation',
    contactEmail: 'david.will@islandconservation.org',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/islandconservationcameratraps/island_conservation_camera_traps_1.02.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/islandconservationcameratraps/public/',
    isZipped: true,
    imageCount: 123000,
    categoryCount: 20
  },
  {
    id: 'channel-islands-camera-traps',
    name: 'Channel Islands Camera Traps',
    description: 'California Channel Islands wildlife with bounding boxes (246K images)',
    longDescription:
      '246,529 camera trap images from 73 locations across the Channel Islands, California. All animals annotated with bounding boxes and classified into five categories: rodent, fox, bird, skunk, and other.',
    citation:
      'The Nature Conservancy (2021). Channel Islands Camera Traps 1.0. The Nature Conservancy. Dataset.',
    organization: 'The Nature Conservancy',
    contactEmail: 'nathaniel.rindlaub@TNC.ORG',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/channel-islands-camera-traps/channel-islands-camera-traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/channel-islands-camera-traps/images/',
    isZipped: true,
    imageCount: 246529,
    categoryCount: 10
  },
  {
    id: 'idaho-camera-traps',
    name: 'Idaho Camera Traps',
    description: 'Wildlife from Idaho, USA (62 species, 1.5M images)',
    longDescription:
      'Approximately 1.5 million camera trap images from Idaho with labels for 62 categories. Primary species include deer, elk, and cattle. About 70.5% of images are labeled empty.',
    citation: null,
    organization: 'Idaho Department of Fish and Game',
    contactEmail: 'info@lila.science',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/idaho-camera-traps/idaho-camera-traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/idaho-camera-traps/public/',
    isZipped: true,
    imageCount: 1500000,
    categoryCount: 62
  },
  {
    id: 'snapshot-serengeti',
    name: 'Snapshot Serengeti',
    description: 'Serengeti National Park, Tanzania (61 species, 7.1M images)',
    longDescription:
      'Approximately 2.65 million image sequences (7.1 million total images) from Serengeti National Park, Tanzania, spanning 11 seasons. Labels for 61 categories with roughly 76% empty. Includes ~150,000 bounding box annotations.',
    citation:
      'Swanson AB, Kosmala M, Lintott CJ, Simpson RJ, Smith A, Packer C (2015). Snapshot Serengeti, high-frequency annotated camera trap images of 40 mammalian species in an African savanna. Scientific Data 2: 150026.',
    organization: 'University of Minnesota',
    contactEmail: 'huebn090@umn.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshotserengeti-v-2-0/SnapshotSerengeti_S1-11_v2_1.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshotserengeti-unzipped/',
    isZipped: true,
    imageCount: 7100000,
    categoryCount: 61
  },
  {
    id: 'snapshot-kgalagadi',
    name: 'Snapshot Kgalagadi',
    description: 'Kgalagadi Transfrontier Park, South Africa (10K images)',
    longDescription:
      'Camera trap images from Kgalagadi Transfrontier Park, stretching from the Namibian border across South Africa and into Botswana, covering the Kalahari arid savanna landscape.',
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'HuebnerS2@si.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KGA/SnapshotKgalagadi_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KGA/KGA_public/',
    isZipped: true,
    imageCount: 10222,
    categoryCount: 30
  },
  {
    id: 'snapshot-enonkishu',
    name: 'Snapshot Enonkishu',
    description: 'Enonkishu Conservancy, Kenya (28K images)',
    longDescription:
      'Camera trap images from Enonkishu Conservancy, located in Kenya on the northern boundary of the Mara-Serengeti ecosystem, promoting coexistence between wildlife and livestock.',
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'HuebnerS2@si.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/ENO/SnapshotEnonkishu_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/ENO/ENO_public/',
    isZipped: true,
    imageCount: 28544,
    categoryCount: 35
  },
  {
    id: 'snapshot-camdeboo',
    name: 'Snapshot Camdeboo',
    description: 'Camdeboo National Park, South Africa (30K images)',
    longDescription:
      'Camera trap images from Camdeboo National Park in the Eastern Cape province of South Africa, within the Nama Karoo ecoregion featuring low vegetation and rock formations.',
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'HuebnerS2@si.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/CDB/SnapshotCamdeboo_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/CDB/CDB_public/',
    isZipped: true,
    imageCount: 30227,
    categoryCount: 35
  },
  {
    id: 'snapshot-mountain-zebra',
    name: 'Snapshot Mountain Zebra',
    description: 'Mountain Zebra National Park, South Africa (73K images)',
    longDescription:
      'Camera trap images from Mountain Zebra National Park, South Africa, dedicated to protecting endangered Cape Mountain zebra populations with steady population increases.',
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'HuebnerS2@si.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/MTZ/SnapshotMountainZebra_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/MTZ/MTZ_public/',
    isZipped: true,
    imageCount: 73034,
    categoryCount: 30
  },
  {
    id: 'snapshot-kruger',
    name: 'Snapshot Kruger',
    description: 'Kruger National Park, South Africa (10K images)',
    longDescription:
      'Camera trap images from Kruger National Park, one of the oldest nature reserves in Africa, home to nearly 150 mammal species.',
    citation: null,
    organization: 'University of Minnesota Lion Center',
    contactEmail: 'HuebnerS2@si.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KRU/SnapshotKruger_S1_v1.0.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/snapshot-safari/KRU/KRU_public/',
    isZipped: true,
    imageCount: 10072,
    categoryCount: 40
  },
  {
    id: 'swg-camera-traps',
    name: 'SWG Camera Traps',
    description: 'Snapshot Wisconsin/Germany wildlife (2M images)',
    longDescription:
      '436,617 camera trap image sequences from 982 locations across Vietnam and Laos, comprising 2,039,657 total images. Labels for 120 species categories with approximately 12.98% empty scenes.',
    citation:
      'SWG (2021). Northern and Central Annamites Camera Traps 2.0. IUCN SSC Asian Wild Cattle Specialist Group Saola Working Group. Dataset.',
    organization: 'Saola Working Group',
    contactEmail: 'saolawg@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/swg-camera-traps/swg_camera_traps.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/swg-camera-traps/',
    isZipped: true,
    imageCount: 2039657,
    categoryCount: 30
  },
  {
    id: 'orinoquia-camera-traps',
    name: 'Orinoquia Camera Traps',
    description: 'Colombian Orinoquia region wildlife (104K images)',
    longDescription:
      '104,782 images from 50 camera traps deployed January-July 2020 across two Colombian nature reserves (El Rey Zamuro and Las Unamas). Contains 51 animal classes with approximately 20% empty frames.',
    citation:
      'Vélez J, McShea W, Shamon H, et al (2023). An evaluation of platforms for processing camera-trap data using artificial intelligence. Methods in Ecology and Evolution, 14(2), 459-477.',
    organization: 'University of Minnesota',
    contactEmail: 'julianavelezgomez@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/orinoquia-camera-traps/orinoquia_camera_traps_metadata.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/orinoquia-camera-traps/public/',
    isZipped: true,
    imageCount: 104782,
    categoryCount: 50
  },
  {
    id: 'nz-trailcams',
    name: 'Trail Camera Images of New Zealand Animals',
    description: 'New Zealand wildlife (2.5M images)',
    longDescription:
      'Approximately 2.5 million camera trap images from various New Zealand projects across diverse habitats. Includes 97 species labels, with mice (49%), possums (6.7%), and rats (5.5%) being most common.',
    citation: null,
    organization: 'New Zealand Department of Conservation',
    contactEmail: 'jtinnemans@doc.govt.nz',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nz-trailcams/trail_camera_images_of_new_zealand_animals_1.00.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/nz-trailcams/',
    isZipped: true,
    imageCount: 2500000,
    categoryCount: 15
  },
  {
    id: 'desert-lion-camera-traps',
    name: 'Desert Lion Conservation Camera Traps',
    description: 'Namibian desert lions (66K images)',
    longDescription:
      '65,959 images and 199 videos from Northern Namibia, collected by the Desert Lion Conservation Project. Annotations for 46 species categories. Focuses on human-lion conflict and conservation.',
    citation: null,
    organization: 'Desert Lion Conservation Project',
    contactEmail: 'peter@addaxdatascience.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/desert-lion-camera-traps/desert_lion_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/desert-lion-camera-traps/annotated-imgs/',
    isZipped: true,
    imageCount: 65959,
    categoryCount: 20
  },
  {
    id: 'ohio-small-animals',
    name: 'Ohio Small Animals',
    description: 'Small mammals from Ohio, USA (45 species, 118K images)',
    longDescription:
      '118,554 camera trap images from the AHDriFT system in Ohio, using fences to guide small animals into enclosures with downward-facing cameras. Labels for 45 species including Eastern garter snakes, song sparrows, and meadow voles.',
    citation:
      'Balasubramaniam S (2024). Optimized Classification in Camera Trap Images: An Approach with Smart Camera Traps, Machine Learning, and Human Inference. Master thesis, The Ohio State University.',
    organization: 'The Ohio State University',
    contactEmail: 'lipps.37@osu.edu',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/osu-small-animals/osu-small-animals.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/osu-small-animals/',
    isZipped: true,
    imageCount: 118554,
    categoryCount: 45
  },
  {
    id: 'seattleish-camera-traps',
    name: 'Seattle(ish) Camera Traps',
    description: 'Urban wildlife from Seattle area, USA',
    longDescription:
      'Approximately 20,000 images in ~6,700 sequences and ~4,500 videos from a residential yard in the Seattle area. Fills gaps in public camera trap data: images of humans (labeled as creator), consumer-grade camera footage, and intact full-size videos. Most common labels: empty, coyote, squirrel, and dog.',
    citation: null,
    organization: null,
    contactName: 'Dan Morris',
    contactEmail: 'agentmorris@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/seattleish-camera-traps/seattleish_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/seattleish-camera-traps/',
    isZipped: true,
    imageCount: 50000,
    categoryCount: 20
  },
  {
    id: 'unsw-predators',
    name: 'UNSW Predators',
    description: 'Australian predator monitoring (131K images)',
    longDescription:
      '131,802 camera trap images from 82 locations in New South Wales, Australia. Species labels: dingo, fox, goanna, possum, and quoll. Cameras deployed near baited sites in Myall Lakes National Park.',
    citation: 'Alting B, et al (2025). UNSW Predators. LILA BC.',
    organization: 'University of New South Wales',
    contactEmail: 'neil.jordan@unsw.edu.au',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/unsw-predators/unsw-predators.json.zip',
    imageBaseUrl: 'https://lilawildlife.blob.core.windows.net/lila-wildlife/unsw-predators/images/',
    isZipped: true,
    imageCount: 131802,
    categoryCount: 15
  },
  {
    id: 'nkhotakota-camera-traps',
    name: 'Nkhotakota Camera Traps',
    description: 'Nkhotakota Wildlife Reserve, Malawi (321K images, some bboxes)',
    longDescription:
      '321,562 images from Nkhotakota Wildlife Reserve in Malawi with labels for 46 taxa. Includes animal counts, bounding box annotations for 33,813 images, and 164,139 empty photos.',
    citation:
      'Appel CL, Subramanian A, et al (2025). Developing custom computer vision models with Njobvu-AI. Ecological Applications, 35(6): e70096.',
    organization: 'African Parks Network',
    contactEmail: 'caraleigh16@gmail.com',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nkhotakota-camera-traps/nkhotakota_camera_traps.json.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/nkhotakota-camera-traps/',
    isZipped: true,
    imageCount: 321562,
    categoryCount: 46
  },
  {
    id: 'california-small-animals',
    name: 'California Small Animals',
    description: 'Small mammals from California, USA (2.2M images)',
    longDescription:
      '2,278,071 camera trap images from California documenting small mammals, reptiles, and amphibians using downward-facing Reconyx cameras deployed with drift fences.',
    citation: null,
    organization: 'California Department of Fish and Wildlife',
    contactEmail: 'lindsey.rich@wildlife.ca.gov',
    metadataUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/california-small-animals/california_small_animals_with_sequences.zip',
    imageBaseUrl:
      'https://lilawildlife.blob.core.windows.net/lila-wildlife/california-small-animals/',
    isZipped: true,
    imageCount: 2278071,
    categoryCount: 30
  }
]

/**
 * Category names that indicate blank/empty images (case-insensitive)
 * These should not create observations - media records are still created
 */
const BLANK_CATEGORY_NAMES = new Set(['empty', 'blank', 'nothing'])

/**
 * Check if a category name represents a blank/empty image
 * @param {string} categoryName - The category name to check
 * @returns {boolean} - True if the category indicates a blank/empty image
 */
function isBlankCategory(categoryName) {
  if (!categoryName) return false
  return BLANK_CATEGORY_NAMES.has(categoryName.toLowerCase().trim())
}

/**
 * Build CamtrapDP-compliant contributors array from LILA dataset metadata
 * @param {Object} dataset - The LILA dataset configuration
 * @returns {Array|null} - Array of contributor objects or null if none available
 */
function buildContributors(dataset) {
  const contributors = []

  // Add organization as publisher (with email if available)
  if (dataset.organization) {
    contributors.push({
      title: dataset.organization,
      email: dataset.contactEmail || undefined,
      role: 'publisher'
    })
  } else if (dataset.contactEmail) {
    // Only create separate contact if no organization
    const contactTitle = dataset.contactName || dataset.contactEmail.split('@')[0] || 'Contact'
    contributors.push({
      title: contactTitle,
      email: dataset.contactEmail,
      role: 'contact'
    })
  }

  // Parse citation for authors as principalInvestigator
  if (dataset.citation) {
    // Extract author names from citation (before year in parentheses)
    // e.g., "Swanson AB, Kosmala M, Lintott CJ (2015)" -> "Swanson AB, Kosmala M, Lintott CJ"
    const authorMatch = dataset.citation.match(/^([^(]+)\s*\(\d{4}\)/)
    if (authorMatch) {
      contributors.push({
        title: authorMatch[1].trim(),
        role: 'principalInvestigator'
      })
    }
  }

  return contributors.length > 0 ? contributors : null
}

/**
 * Import a LILA dataset by its ID
 * @param {string} datasetId - ID of the LILA dataset to import
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} - Object containing dbPath and metadata
 */
export async function importLilaDataset(datasetId, id, onProgress = null) {
  const biowatchDataPath = getBiowatchDataPath()
  return await importLilaDatasetWithPath(datasetId, biowatchDataPath, id, onProgress)
}

/**
 * Import a LILA dataset (core function for testing)
 * @param {string} datasetId - ID of the LILA dataset to import
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} - Object containing dbPath and metadata
 */
export async function importLilaDatasetWithPath(
  datasetId,
  biowatchDataPath,
  id,
  onProgress = null
) {
  log.info(`Starting LILA dataset import for: ${datasetId}`)

  // Find the dataset configuration
  const dataset = LILA_DATASETS.find((d) => d.id === datasetId)
  if (!dataset) {
    throw new Error(`Unknown LILA dataset: ${datasetId}`)
  }

  // Create database in the specified biowatch-data directory
  const dbPath = path.join(biowatchDataPath, 'studies', id, 'study.db')
  log.info(`Creating database at: ${dbPath}`)

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // Use streaming import for large datasets to avoid memory exhaustion
  if (dataset.imageCount && dataset.imageCount >= STREAMING_THRESHOLD) {
    log.info(
      `Dataset has ${dataset.imageCount} images (>= ${STREAMING_THRESHOLD}), using streaming import`
    )
    try {
      return await importLilaDatasetStreaming(dataset, dbPath, id, onProgress)
    } catch (error) {
      log.error('Error during streaming LILA import:', error)

      if (onProgress) {
        onProgress({
          stage: 'error',
          stageIndex: -1,
          totalStages: 3,
          datasetTitle: dataset.name,
          error: {
            message: error.message
          }
        })
      }

      throw error
    }
  }

  // Standard in-memory import for smaller datasets
  log.info(`Dataset has ${dataset.imageCount || 'unknown'} images, using standard import`)

  // Get database manager and Drizzle instance
  const manager = await getStudyDatabase(id, dbPath)
  const db = manager.getDb()

  // Enable import mode for faster bulk inserts
  manager.setImportMode()

  try {
    // Stage 1: Download metadata
    if (onProgress) {
      onProgress({
        stage: 'downloading',
        stageIndex: 0,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    const cocoData = await downloadAndParseMetadata(dataset, onProgress)
    log.info(`Downloaded metadata: ${cocoData.images?.length || 0} images`)

    // Stage 2: Parse COCO format
    if (onProgress) {
      onProgress({
        stage: 'parsing',
        stageIndex: 1,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    // Validate COCO data
    const validationErrors = validateCOCOData(cocoData)
    if (validationErrors.length > 0) {
      throw new Error(`Invalid COCO data: ${validationErrors.join(', ')}`)
    }

    // Build category lookup map
    const categoryMap = new Map()
    if (cocoData.categories) {
      for (const cat of cocoData.categories) {
        categoryMap.set(cat.id, cat.name)
      }
    }
    log.info(`Built category map with ${categoryMap.size} categories`)

    // Build image lookup map for annotations
    const imageMap = new Map()
    for (const img of cocoData.images) {
      imageMap.set(img.id, img)
    }

    // Compute sequence bounds for event temporal range
    const sequenceBounds = computeSequenceBounds(cocoData.images)
    log.info(`Computed bounds for ${sequenceBounds.size} sequences`)

    // Transform data
    const deploymentsData = transformCOCOToDeployments(cocoData.images)
    const mediaData = transformCOCOToMedia(cocoData.images, dataset.imageBaseUrl)
    const observationsData = transformCOCOToObservations(
      cocoData.annotations || [],
      categoryMap,
      imageMap,
      sequenceBounds
    )

    log.info(
      `Transformed: ${deploymentsData.length} deployments, ${mediaData.length} media, ${observationsData.length} observations`
    )

    // Stage 3: Import to database
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    // Insert deployments
    await batchInsert(
      db,
      deployments,
      deploymentsData,
      'deployments',
      (progress) => {
        if (onProgress) {
          onProgress({
            stage: 'importing',
            stageIndex: 2,
            totalStages: 3,
            datasetTitle: dataset.name,
            importProgress: {
              table: 'deployments',
              ...progress
            }
          })
        }
      },
      manager
    )

    // Insert media
    await batchInsert(
      db,
      media,
      mediaData,
      'media',
      (progress) => {
        if (onProgress) {
          onProgress({
            stage: 'importing',
            stageIndex: 2,
            totalStages: 3,
            datasetTitle: dataset.name,
            importProgress: {
              table: 'media',
              ...progress
            }
          })
        }
      },
      manager
    )

    // Insert observations
    await batchInsert(
      db,
      observations,
      observationsData,
      'observations',
      (progress) => {
        if (onProgress) {
          onProgress({
            stage: 'importing',
            stageIndex: 2,
            totalStages: 3,
            datasetTitle: dataset.name,
            importProgress: {
              table: 'observations',
              ...progress
            }
          })
        }
      },
      manager
    )

    // Insert metadata
    const metadataRecord = {
      id,
      name: dataset.name,
      title: cocoData.info?.description || dataset.name,
      description: dataset.longDescription || dataset.description,
      created: new Date().toISOString(),
      importerName: 'lila/coco',
      contributors: buildContributors(dataset),
      startDate: null,
      endDate: null,
      sequenceGap: DEFAULT_SEQUENCE_GAP
    }
    await insertMetadata(db, metadataRecord)
    log.info('Inserted study metadata into database')

    // Signal completion
    if (onProgress) {
      onProgress({
        stage: 'complete',
        stageIndex: 3,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    log.info('LILA dataset import completed successfully')

    return {
      dbPath,
      data: metadataRecord
    }
  } catch (error) {
    log.error('Error importing LILA dataset:', error)

    if (onProgress) {
      onProgress({
        stage: 'error',
        stageIndex: -1,
        totalStages: 3,
        datasetTitle: dataset.name,
        error: {
          message: error.message
        }
      })
    }

    throw error
  } finally {
    // Reset import mode to safe defaults
    manager.resetImportMode()
  }
}

/**
 * Download and parse LILA metadata (JSON or ZIP)
 */
async function downloadAndParseMetadata(dataset, onProgress) {
  const tempDir = path.join(os.tmpdir(), 'biowatch-lila-import')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  if (dataset.isZipped) {
    // Download ZIP file
    const zipPath = path.join(tempDir, `${dataset.id}.zip`)
    await downloadFileWithRetry(dataset.metadataUrl, zipPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    // Extract ZIP
    const extractPath = path.join(tempDir, dataset.id)
    await extractZip(zipPath, extractPath)

    // Find JSON file in extracted contents
    const jsonFile = findJsonFile(extractPath)
    if (!jsonFile) {
      throw new Error('No JSON file found in ZIP archive')
    }

    const jsonContent = fs.readFileSync(jsonFile, 'utf8')
    return JSON.parse(sanitizeJsonString(jsonContent))
  } else {
    // Download JSON directly
    const jsonPath = path.join(tempDir, `${dataset.id}.json`)
    await downloadFileWithRetry(dataset.metadataUrl, jsonPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    const jsonContent = fs.readFileSync(jsonPath, 'utf8')
    return JSON.parse(sanitizeJsonString(jsonContent))
  }
}

/**
 * Sanitize JSON string by replacing invalid NaN values with null
 * LILA datasets sometimes contain NaN from Python/NumPy which is not valid JSON
 */
function sanitizeJsonString(jsonString) {
  // Replace standalone NaN (not part of a string) with null
  // Matches: NaN preceded by colon and optional whitespace, followed by comma, closing bracket, or whitespace
  return jsonString.replace(/:\s*NaN\s*([,}\]])/g, ': null$1')
}

/**
 * Create a transform stream that sanitizes NaN values for JSON parsing
 * Handles NaN values that Python/NumPy exports (not valid JSON)
 * Used for streaming large files that can't be loaded into memory
 */
function createNaNSanitizer() {
  let buffer = ''

  return new Transform({
    transform(chunk, encoding, callback) {
      buffer += chunk.toString()

      // Process complete patterns, keep potential partial match at end
      // Pattern: `: NaN` followed by `,` or `}` or `]`
      const processed = buffer.replace(/:\s*NaN\s*([,}\]])/g, ': null$1')

      // Keep last 10 characters in case NaN is split across chunks
      const safeLength = Math.max(0, processed.length - 10)
      this.push(processed.slice(0, safeLength))
      buffer = processed.slice(safeLength)

      callback()
    },
    flush(callback) {
      // Process remaining buffer
      const processed = buffer.replace(/:\s*NaN\s*([,}\]])/g, ': null$1')
      this.push(processed)
      callback()
    }
  })
}

/**
 * Recursively find a JSON file in a directory
 */
function findJsonFile(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findJsonFile(fullPath)
      if (found) return found
    } else if (entry.name.endsWith('.json')) {
      return fullPath
    }
  }

  return null
}

/**
 * Validate COCO Camera Traps data structure
 */
function validateCOCOData(data) {
  const errors = []

  if (!data.images || !Array.isArray(data.images)) {
    errors.push('Missing or invalid "images" array')
  }

  if (data.images && data.images.length === 0) {
    errors.push('Empty "images" array')
  }

  // categories and annotations can be optional
  if (data.categories && !Array.isArray(data.categories)) {
    errors.push('Invalid "categories" - must be array if present')
  }

  if (data.annotations && !Array.isArray(data.annotations)) {
    errors.push('Invalid "annotations" - must be array if present')
  }

  return errors
}

/**
 * Compute temporal bounds (min/max datetime) for each sequence ID
 * This is used to set accurate eventStart/eventEnd for observations
 * @param {Array} images - COCO images array
 * @returns {Map} - Map of seq_id → {start: ISO string, end: ISO string}
 */
function computeSequenceBounds(images) {
  const sequenceBounds = new Map()

  for (const img of images) {
    // Skip images without seq_id - they don't have sequence info
    if (!img.seq_id) continue

    const seqId = String(img.seq_id)
    const datetime = img.datetime ? transformDateField(img.datetime) : null

    if (!datetime) continue

    if (!sequenceBounds.has(seqId)) {
      sequenceBounds.set(seqId, { start: datetime, end: datetime })
    } else {
      const bounds = sequenceBounds.get(seqId)
      if (datetime < bounds.start) bounds.start = datetime
      if (datetime > bounds.end) bounds.end = datetime
    }
  }

  return sequenceBounds
}

/**
 * Transform COCO images to Biowatch deployments
 * Uses the 'location' field as deploymentID
 * Computes deploymentStart/deploymentEnd from MIN/MAX image datetimes per location
 */
function transformCOCOToDeployments(images) {
  // Group images by location and compute temporal bounds
  const locationData = new Map()

  for (const img of images) {
    if (!img.location) continue

    const loc = String(img.location)
    if (!locationData.has(loc)) {
      locationData.set(loc, {
        minDatetime: null,
        maxDatetime: null
      })
    }

    const data = locationData.get(loc)
    const imgDatetime = img.datetime ? transformDateField(img.datetime) : null

    if (imgDatetime) {
      if (!data.minDatetime || imgDatetime < data.minDatetime) {
        data.minDatetime = imgDatetime
      }
      if (!data.maxDatetime || imgDatetime > data.maxDatetime) {
        data.maxDatetime = imgDatetime
      }
    }
  }

  return Array.from(locationData.entries()).map(([location, data]) => ({
    deploymentID: location,
    locationID: location,
    locationName: location,
    deploymentStart: data.minDatetime,
    deploymentEnd: data.maxDatetime,
    latitude: null,
    longitude: null,
    cameraModel: null,
    cameraID: null,
    coordinateUncertainty: null
  }))
}

/**
 * Transform COCO images to Biowatch media
 * Constructs HTTP URLs for lazy loading
 */
function transformCOCOToMedia(images, imageBaseUrl) {
  return images.map((img) => ({
    mediaID: String(img.id),
    deploymentID: img.location ? String(img.location) : null,
    timestamp: transformDateField(img.datetime),
    filePath: `${imageBaseUrl}${img.file_name}`,
    fileName: img.file_name,
    fileMediatype: getMediaTypeFromFileName(img.file_name),
    exifData: null,
    favorite: false
  }))
}

/**
 * Transform COCO annotations to Biowatch observations
 * Filters out blank/empty categories - no observation is created for those
 * Uses seq_id for eventID and sequenceBounds for eventStart/eventEnd
 * @param {Array} annotations - COCO annotations array
 * @param {Map} categoryMap - Map of category_id → category_name
 * @param {Map} imageMap - Map of image_id → image object
 * @param {Map} sequenceBounds - Map of seq_id → {start, end} temporal bounds
 */
function transformCOCOToObservations(annotations, categoryMap, imageMap, sequenceBounds) {
  return annotations
    .map((ann, index) => {
      const image = imageMap.get(ann.image_id)
      const categoryName = categoryMap.get(ann.category_id) || 'Unknown'

      // Filter out blank/empty categories - no observation should be created
      // Media records are still created, but blank images have no observation
      if (isBlankCategory(categoryName)) {
        return null
      }

      // Normalize bounding box from pixels to 0-1
      const bbox = normalizeBbox(ann.bbox, image?.width, image?.height)

      // Extract eventID from COCO seq_id field (if available)
      const eventID = image?.seq_id ? String(image.seq_id) : null

      // Get event temporal bounds from pre-computed sequence bounds
      // Fall back to individual image datetime if no sequence info
      const seqBounds = eventID ? sequenceBounds.get(eventID) : null
      const imageDatetime = image?.datetime ? transformDateField(image.datetime) : null
      const eventStart = seqBounds?.start || imageDatetime
      const eventEnd = seqBounds?.end || imageDatetime

      return {
        observationID: ann.id ? String(ann.id) : `obs_${ann.image_id}_${index}`,
        mediaID: String(ann.image_id),
        deploymentID: image?.location ? String(image.location) : null,
        eventID,
        eventStart,
        eventEnd,
        scientificName: categoryName,
        commonName: categoryName,
        observationType: 'animal',
        classificationProbability: null,
        count: 1,
        lifeStage: null,
        age: null,
        sex: null,
        behavior: null,
        bboxX: bbox?.bboxX ?? null,
        bboxY: bbox?.bboxY ?? null,
        bboxWidth: bbox?.bboxWidth ?? null,
        bboxHeight: bbox?.bboxHeight ?? null
      }
    })
    .filter(Boolean) // Remove null entries (filtered blank/empty categories)
}

/**
 * Normalize COCO bbox from pixels to 0-1 coordinates
 * COCO format: [x, y, width, height] in pixels (top-left origin)
 * Biowatch format: normalized 0-1 coordinates
 */
function normalizeBbox(bbox, imageWidth, imageHeight) {
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return null
  }

  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return null
  }

  const [x, y, width, height] = bbox

  return {
    bboxX: x / imageWidth,
    bboxY: y / imageHeight,
    bboxWidth: width / imageWidth,
    bboxHeight: height / imageHeight
  }
}

/**
 * Transform date field from COCO format to ISO
 */
function transformDateField(dateValue) {
  if (!dateValue) return null

  // Try ISO format first
  let date = DateTime.fromISO(dateValue)
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  // Try COCO common format: "2022-12-31 09:52:50"
  date = DateTime.fromFormat(dateValue, 'yyyy-MM-dd HH:mm:ss')
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  return null
}

/**
 * Get MIME type from file name
 */
function getMediaTypeFromFileName(fileName) {
  if (!fileName) return 'image/jpeg'

  const ext = fileName.toLowerCase().split('.').pop()
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp'
  }

  return mimeTypes[ext] || 'image/jpeg'
}

/**
 * Convert a JavaScript value to a SQLite-compatible value.
 * SQLite only accepts: numbers, strings, bigints, buffers, and null.
 * @param {any} value - JavaScript value to convert
 * @returns {number|string|bigint|Buffer|null} SQLite-compatible value
 */
function toSqliteValue(value) {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Create a transaction-wrapped bulk inserter for high-performance batch inserts.
 * Uses raw prepared statements instead of Drizzle ORM for maximum speed.
 * @param {Database} sqlite - Raw better-sqlite3 connection
 * @param {string} tableName - Name of the table to insert into
 * @param {string[]} columns - Array of column names
 * @returns {Function} Transaction-wrapped inserter function
 */
function createBulkInserter(sqlite, tableName, columns) {
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
  const stmt = sqlite.prepare(sql)

  return sqlite.transaction((rows) => {
    for (const row of rows) {
      stmt.run(...columns.map((col) => toSqliteValue(row[col])))
    }
  })
}

/**
 * Batch insert data into database using transaction-wrapped raw SQL for performance.
 * @param {object} db - Drizzle database instance (unused but kept for API compatibility)
 * @param {object} table - Drizzle table schema (unused but kept for API compatibility)
 * @param {Array} data - Array of row objects to insert
 * @param {string} tableName - Name of the table
 * @param {Function} onProgress - Progress callback
 * @param {object} manager - StudyDatabaseManager instance for raw SQLite access
 */
async function batchInsert(db, table, data, tableName, onProgress, manager) {
  if (data.length === 0) {
    log.info(`No data to insert for ${tableName}`)
    return
  }

  const batchSize = 2000 // Increased from 1000 for better throughput
  const totalBatches = Math.ceil(data.length / batchSize)

  // Get column names from first row and create bulk inserter
  const columns = Object.keys(data[0])
  const sqlite = manager.getSqlite()
  const inserter = createBulkInserter(sqlite, tableName, columns)

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    inserter(batch) // Transaction-wrapped insert

    const insertedRows = Math.min(i + batchSize, data.length)
    const batchNumber = Math.floor(i / batchSize) + 1

    log.debug(`Inserted batch ${batchNumber}/${totalBatches} into ${tableName}`)

    if (onProgress) {
      onProgress({
        insertedRows,
        totalRows: data.length,
        batchNumber,
        totalBatches
      })
    }
  }

  log.info(`Completed insertion of ${data.length} rows into ${tableName}`)
}

// ============================================================================
// STREAMING IMPORT FUNCTIONS (for large datasets like Serengeti)
// ============================================================================

// Batch size for streaming inserts. Using transaction-wrapped raw SQL
// allows much larger batches (2000 rows) for better throughput.
const CHUNK_SIZE = 2000

/**
 * Stream and extract categories from COCO JSON using stream-json
 * Categories are small enough to hold in memory
 * Uses pick() to efficiently locate categories array regardless of position in file
 * @param {string} jsonPath - Path to the COCO JSON file
 * @returns {Promise<Map>} - Map of category_id → category_name
 */
async function streamCategories(jsonPath) {
  return new Promise((resolve, reject) => {
    const categoryMap = new Map()

    // Use stream-json with pick() to efficiently extract just the categories array
    // This works regardless of where categories appear in the file (before or after images)
    // NaN sanitizer handles invalid NaN values from Python/NumPy exports
    const pipeline = chain([
      fs.createReadStream(jsonPath),
      createNaNSanitizer(),
      parser(),
      pick({ filter: 'categories' }),
      streamArray()
    ])

    pipeline.on('data', ({ value }) => {
      // Each value is a category object from the categories array
      if (value && typeof value === 'object' && 'id' in value && 'name' in value) {
        categoryMap.set(value.id, value.name)
      }
    })

    pipeline.on('end', () => {
      if (categoryMap.size === 0) {
        log.warn('No categories found in JSON file')
      } else {
        log.info(`Streamed ${categoryMap.size} categories from JSON`)
      }
      resolve(categoryMap)
    })

    pipeline.on('error', (error) => {
      log.error('Error streaming categories:', error)
      reject(error)
    })
  })
}

/**
 * Stream images from COCO JSON to compute bounds and write JSONL
 * Does NOT insert to database - just computes bounds and writes temp file
 * @param {string} jsonPath - Path to the COCO JSON file
 * @param {string} tempJsonlPath - Path for temp JSONL file
 * @param {object} dataset - Dataset configuration (for file_name prefix)
 * @param {Map} sequenceBounds - Map to populate with seq_id → {start, end}
 * @param {Map} deploymentBounds - Map to populate with location → {min, max}
 * @param {function} onProgress - Progress callback
 * @returns {Promise<number>} - Total number of images processed
 */
async function computeBoundsAndWriteJsonl(
  jsonPath,
  tempJsonlPath,
  dataset,
  sequenceBounds,
  deploymentBounds,
  onProgress
) {
  // Clear temp JSONL file if it exists
  if (fs.existsSync(tempJsonlPath)) {
    fs.unlinkSync(tempJsonlPath)
  }

  return new Promise((resolve, reject) => {
    let totalImages = 0
    let chunk = []

    // Diagnostic counters to understand data patterns
    let imagesWithLocationNoDatetime = 0
    const allLocations = new Set()

    // Process a chunk of images: compute bounds and write to JSONL
    const processChunk = async (images) => {
      if (images.length === 0) return

      // Process each image: update bounds and write to JSONL
      const jsonlLines = []
      for (const img of images) {
        const datetime = img.datetime ? transformDateField(img.datetime) : null
        const imgId = String(img.id)
        const location = img.location ? String(img.location) : null
        const seqId = img.seq_id ? String(img.seq_id) : null

        // Track all unique locations for diagnostics
        if (location) {
          allLocations.add(location)
          if (!datetime) {
            imagesWithLocationNoDatetime++
          }
        }

        // Update sequence bounds in memory
        if (seqId && datetime) {
          if (!sequenceBounds.has(seqId)) {
            sequenceBounds.set(seqId, { start: datetime, end: datetime })
          } else {
            const bounds = sequenceBounds.get(seqId)
            if (datetime < bounds.start) bounds.start = datetime
            if (datetime > bounds.end) bounds.end = datetime
          }
        }

        // Update deployment bounds in memory
        // Create deployment for ANY image with location (even without datetime)
        if (location) {
          if (!deploymentBounds.has(location)) {
            deploymentBounds.set(location, { min: datetime, max: datetime })
          } else if (datetime) {
            // Only update bounds if we have a datetime
            const bounds = deploymentBounds.get(location)
            if (!bounds.min || datetime < bounds.min) bounds.min = datetime
            if (!bounds.max || datetime > bounds.max) bounds.max = datetime
          }
        }

        // Prepare image metadata for JSONL (needed for media insertion and annotation lookup)
        // Include file_name for media insertion later
        jsonlLines.push(
          JSON.stringify({
            id: imgId,
            location,
            seq_id: seqId,
            datetime,
            file_name: img.file_name,
            width: img.width || null,
            height: img.height || null
          })
        )
      }

      // Write to JSONL file
      fs.appendFileSync(tempJsonlPath, jsonlLines.join('\n') + '\n')

      totalImages += images.length

      if (onProgress) {
        const expectedImages = dataset.imageCount || 0
        const percent =
          expectedImages > 0 ? Math.round((totalImages / expectedImages) * 1000) / 10 : 0
        onProgress({
          stage: 'parsing',
          stageIndex: 1,
          totalStages: 3,
          datasetTitle: dataset.name,
          detail: `Computing bounds... ${totalImages} images`,
          parsingProgress: {
            phase: 'computing_bounds',
            phaseLabel: 'Computing image bounds',
            processed: totalImages,
            total: expectedImages,
            percent
          }
        })
      }

      log.debug(`Processed ${totalImages} images so far`)
    }

    // Create streaming pipeline for images array
    // Use pick() to select the 'images' key from the COCO object
    // NaN sanitizer handles invalid NaN values from Python/NumPy exports
    const pipeline = chain([
      fs.createReadStream(jsonPath),
      createNaNSanitizer(),
      parser(),
      pick({ filter: 'images' }),
      streamArray()
    ])

    pipeline.on('data', async ({ value }) => {
      // Each value is an image object from the images array
      if (value && typeof value === 'object' && 'file_name' in value && 'id' in value) {
        chunk.push(value)

        if (chunk.length >= CHUNK_SIZE) {
          pipeline.pause()
          try {
            await processChunk(chunk)
            chunk = []
          } catch (error) {
            pipeline.destroy()
            reject(error)
            return
          }
          pipeline.resume()
        }
      }
    })

    pipeline.on('end', async () => {
      try {
        // Process remaining chunk
        await processChunk(chunk)
        log.info(`Completed streaming ${totalImages} images to JSONL`)
        log.info(
          `Computed ${sequenceBounds.size} sequence bounds, ${deploymentBounds.size} deployment bounds`
        )
        // Diagnostic logging to understand data patterns
        log.info(`[DIAGNOSTIC] Total unique locations: ${allLocations.size}`)
        log.info(
          `[DIAGNOSTIC] Images with location but NO datetime: ${imagesWithLocationNoDatetime}`
        )
        log.info(`[DIAGNOSTIC] Deployments created: ${deploymentBounds.size}`)
        resolve(totalImages)
      } catch (error) {
        reject(error)
      }
    })

    pipeline.on('error', (error) => {
      log.error('Error streaming images:', error)
      reject(error)
    })
  })
}

/**
 * Insert media records from JSONL file to database
 * @param {string} tempJsonlPath - Path to the temp JSONL file
 * @param {object} mainDb - Main Drizzle database (unused, kept for API compatibility)
 * @param {object} dataset - Dataset configuration
 * @param {function} onProgress - Progress callback
 * @param {object} manager - StudyDatabaseManager for raw SQLite access
 * @returns {Promise<number>} - Total number of media records inserted
 */
async function insertMediaFromJsonl(tempJsonlPath, mainDb, dataset, onProgress, manager) {
  // Create bulk inserter for media table using raw SQL
  const sqlite = manager.getSqlite()
  const mediaColumns = [
    'mediaID',
    'deploymentID',
    'timestamp',
    'filePath',
    'fileName',
    'fileMediatype',
    'exifData',
    'favorite'
  ]
  const mediaInserter = createBulkInserter(sqlite, 'media', mediaColumns)

  return new Promise((resolve, reject) => {
    let totalInserted = 0
    let chunk = []

    const insertChunk = async (images) => {
      if (images.length === 0) return

      const mediaData = images.map((img) => ({
        mediaID: String(img.id),
        deploymentID: img.location ? String(img.location) : null,
        timestamp: img.datetime || null,
        filePath: `${dataset.imageBaseUrl}${img.file_name}`,
        fileName: img.file_name,
        fileMediatype: getMediaTypeFromFileName(img.file_name),
        exifData: null,
        favorite: false
      }))

      mediaInserter(mediaData) // Transaction-wrapped bulk insert
      totalInserted += images.length

      if (onProgress) {
        onProgress({
          stage: 'importing',
          stageIndex: 2,
          totalStages: 3,
          datasetTitle: dataset.name,
          importProgress: {
            table: 'media',
            insertedRows: totalInserted,
            totalRows: dataset.imageCount || totalInserted
          }
        })
      }
    }

    const readStream = fs.createReadStream(tempJsonlPath, { encoding: 'utf8' })
    let buffer = ''

    readStream.on('data', async (data) => {
      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const img = JSON.parse(line)
            chunk.push(img)

            if (chunk.length >= CHUNK_SIZE) {
              readStream.pause()
              try {
                await insertChunk(chunk)
                chunk = []
              } catch (error) {
                readStream.destroy()
                reject(error)
                return
              }
              readStream.resume()
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    })

    readStream.on('end', async () => {
      try {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const img = JSON.parse(buffer)
            chunk.push(img)
          } catch {
            // Skip malformed line
          }
        }
        // Insert remaining chunk
        await insertChunk(chunk)
        log.info(`Inserted ${totalInserted} media records from JSONL`)
        resolve(totalInserted)
      } catch (error) {
        reject(error)
      }
    })

    readStream.on('error', reject)
  })
}

/**
 * Load image metadata from JSONL file into a Map
 * @param {string} tempJsonlPath - Path to the temp JSONL file
 * @param {number} expectedCount - Expected number of images (for progress calculation)
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Map>} - Map of image_id → image metadata
 */
async function loadImageMapFromJsonl(tempJsonlPath, expectedCount = 0, onProgress = null) {
  // Immediate progress update at phase start
  if (onProgress) {
    onProgress({
      phase: 'loading_metadata',
      phaseLabel: 'Loading image metadata',
      processed: 0,
      total: expectedCount,
      percent: 0
    })
  }

  return new Promise((resolve, reject) => {
    const imageMap = new Map()
    let lastProgressUpdate = 0
    const PROGRESS_THROTTLE = 10000 // Update progress every 10k lines

    const readStream = fs.createReadStream(tempJsonlPath, { encoding: 'utf8' })
    let buffer = ''

    readStream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const img = JSON.parse(line)
            imageMap.set(img.id, img)
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Report progress periodically
      const currentSize = imageMap.size
      if (onProgress && currentSize - lastProgressUpdate >= PROGRESS_THROTTLE) {
        lastProgressUpdate = currentSize
        const percent =
          expectedCount > 0 ? Math.round((currentSize / expectedCount) * 1000) / 10 : 0
        onProgress({
          phase: 'loading_metadata',
          phaseLabel: 'Loading image metadata',
          processed: currentSize,
          total: expectedCount,
          percent
        })
      }
    })

    readStream.on('end', () => {
      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const img = JSON.parse(buffer)
          imageMap.set(img.id, img)
        } catch {
          // Skip malformed line
        }
      }
      log.info(`Loaded ${imageMap.size} images from JSONL into memory`)
      resolve(imageMap)
    })

    readStream.on('error', reject)
  })
}
/**
 * Count annotations in COCO JSON file using streaming
 * This provides the total count for accurate progress reporting
 * @param {string} jsonPath - Path to the COCO JSON file
 * @param {function} onProgress - Progress callback (optional)
 * @returns {Promise<number>} - Total number of annotations
 */
async function countAnnotationsStreaming(jsonPath, onProgress = null) {
  // Get file size for byte-based progress estimation
  const fileStats = fs.statSync(jsonPath)
  const totalBytes = fileStats.size

  // Immediate progress update at phase start
  if (onProgress) {
    onProgress({
      phase: 'counting_annotations',
      phaseLabel: 'Counting annotations',
      processed: 0,
      total: null,
      bytesRead: 0,
      totalBytes,
      percent: 0
    })
  }

  return new Promise((resolve, reject) => {
    let count = 0
    let bytesRead = 0
    let lastProgressUpdate = 0
    const PROGRESS_THROTTLE = 50000 // Update every 50k annotations

    // Create read stream and track bytes
    const readStream = fs.createReadStream(jsonPath)

    readStream.on('data', (chunk) => {
      bytesRead += chunk.length
    })

    const pipeline = chain([
      readStream,
      createNaNSanitizer(),
      parser(),
      pick({ filter: 'annotations' }),
      streamArray()
    ])

    pipeline.on('data', ({ value }) => {
      if (value && typeof value === 'object' && 'category_id' in value && 'image_id' in value) {
        count++

        // Report progress periodically
        if (onProgress && count - lastProgressUpdate >= PROGRESS_THROTTLE) {
          lastProgressUpdate = count
          const percent = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 1000) / 10 : 0
          onProgress({
            phase: 'counting_annotations',
            phaseLabel: 'Counting annotations',
            processed: count,
            total: null, // Unknown ahead of time
            bytesRead,
            totalBytes,
            percent
          })
        }
      }
    })

    pipeline.on('end', () => {
      log.info(`Counted ${count} annotations in COCO file`)
      resolve(count)
    })

    pipeline.on('error', (error) => {
      log.error('Error counting annotations:', error)
      reject(error)
    })
  })
}

/**
 * Stream annotations from COCO JSON, processing in chunks
 * Looks up image metadata from JSONL file and uses in-memory sequence bounds
 * @param {string} jsonPath - Path to the COCO JSON file
 * @param {string} tempJsonlPath - Path to temp JSONL file with image metadata
 * @param {object} mainDb - Main Drizzle database
 * @param {Map} categoryMap - Map of category_id → category_name
 * @param {Map} sequenceBounds - Map of seq_id → {start, end}
 * @param {object} dataset - Dataset configuration
 * @param {number} totalAnnotations - Total number of annotations for progress reporting
 * @param {function} onProgress - Progress callback
 * @param {object} manager - StudyDatabaseManager for raw SQLite access
 * @returns {Promise<number>} - Total number of observations created
 */
async function streamAnnotationsPass(
  jsonPath,
  tempJsonlPath,
  mainDb,
  categoryMap,
  sequenceBounds,
  dataset,
  totalAnnotations,
  onProgress,
  manager
) {
  // Create bulk inserter for observations table using raw SQL
  const sqlite = manager.getSqlite()
  const observationsColumns = [
    'observationID',
    'mediaID',
    'deploymentID',
    'eventID',
    'eventStart',
    'eventEnd',
    'scientificName',
    'commonName',
    'observationType',
    'classificationProbability',
    'count',
    'lifeStage',
    'age',
    'sex',
    'behavior',
    'bboxX',
    'bboxY',
    'bboxWidth',
    'bboxHeight'
  ]
  const observationsInserter = createBulkInserter(sqlite, 'observations', observationsColumns)

  // Load image metadata from JSONL into memory
  // For 7M images this is ~500MB but we need it for annotation lookups
  log.info('Loading image metadata from JSONL for annotation processing...')
  const expectedImageCount = dataset.imageCount || 0
  const imageMap = await loadImageMapFromJsonl(tempJsonlPath, expectedImageCount, (progress) => {
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: `Loading image metadata... ${progress.processed.toLocaleString()}`,
        importProgress: {
          table: 'Loading metadata',
          insertedRows: progress.processed,
          totalRows: progress.total
        }
      })
    }
  })

  return new Promise((resolve, reject) => {
    let totalObservations = 0
    let chunk = []
    let chunkIndex = 0

    // Process a chunk of annotations
    const processChunk = async (annotations) => {
      if (annotations.length === 0) return

      const observationsData = []

      for (let idx = 0; idx < annotations.length; idx++) {
        const ann = annotations[idx]
        const categoryName = categoryMap.get(ann.category_id) || 'Unknown'

        // Filter out blank/empty categories
        if (isBlankCategory(categoryName)) {
          continue
        }

        // Look up image info from in-memory Map
        const imageInfo = imageMap.get(String(ann.image_id))

        if (!imageInfo) {
          // Image not found - skip this annotation
          continue
        }

        // Normalize bounding box
        const bbox = normalizeBbox(ann.bbox, imageInfo.width, imageInfo.height)

        // Get event info from sequence bounds
        const eventID = imageInfo.seq_id || null
        const imageDatetime = imageInfo.datetime || null
        const seqBounds = eventID ? sequenceBounds.get(eventID) : null
        const eventStart = seqBounds?.start || imageDatetime
        const eventEnd = seqBounds?.end || imageDatetime

        observationsData.push({
          observationID: ann.id ? String(ann.id) : `obs_${ann.image_id}_${chunkIndex}_${idx}`,
          mediaID: String(ann.image_id),
          deploymentID: imageInfo.location || null,
          eventID,
          eventStart,
          eventEnd,
          scientificName: categoryName,
          commonName: categoryName,
          observationType: 'animal',
          classificationProbability: null,
          count: 1,
          lifeStage: null,
          age: null,
          sex: null,
          behavior: null,
          bboxX: bbox?.bboxX ?? null,
          bboxY: bbox?.bboxY ?? null,
          bboxWidth: bbox?.bboxWidth ?? null,
          bboxHeight: bbox?.bboxHeight ?? null
        })
      }

      if (observationsData.length > 0) {
        observationsInserter(observationsData) // Transaction-wrapped bulk insert
        totalObservations += observationsData.length
      }

      chunkIndex++

      if (onProgress) {
        onProgress({
          stage: 'importing',
          stageIndex: 2,
          totalStages: 3,
          datasetTitle: dataset.name,
          importProgress: {
            table: 'observations',
            insertedRows: totalObservations,
            totalRows: totalAnnotations
          }
        })
      }

      log.debug(`Processed ${totalObservations} observations so far`)
    }

    // Create streaming pipeline for annotations array
    // Use pick() to select the 'annotations' key from the COCO object
    // NaN sanitizer handles invalid NaN values from Python/NumPy exports
    const pipeline = chain([
      fs.createReadStream(jsonPath),
      createNaNSanitizer(),
      parser(),
      pick({ filter: 'annotations' }),
      streamArray()
    ])

    pipeline.on('data', async ({ value }) => {
      // Each value is an annotation object from the annotations array
      if (value && typeof value === 'object' && 'category_id' in value && 'image_id' in value) {
        chunk.push(value)

        if (chunk.length >= CHUNK_SIZE) {
          pipeline.pause()
          try {
            await processChunk(chunk)
            chunk = []
          } catch (error) {
            pipeline.destroy()
            reject(error)
            return
          }
          pipeline.resume()
        }
      }
    })

    pipeline.on('end', async () => {
      try {
        // Process remaining chunk
        await processChunk(chunk)
        log.info(`Completed streaming ${totalObservations} observations`)
        resolve(totalObservations)
      } catch (error) {
        reject(error)
      }
    })

    pipeline.on('error', (error) => {
      log.error('Error streaming annotations:', error)
      reject(error)
    })
  })
}

/**
 * Insert deployments from in-memory bounds Map to main database
 * @param {Map} deploymentBounds - Map of location → {min, max}
 * @param {object} mainDb - Main Drizzle database (unused, kept for API compatibility)
 * @param {object} manager - StudyDatabaseManager for raw SQLite access
 * @returns {Promise<number>} - Number of deployments inserted
 */
async function insertDeploymentsFromBounds(deploymentBounds, mainDb, manager) {
  const deploymentEntries = Array.from(deploymentBounds.entries())

  if (deploymentEntries.length === 0) {
    log.info('No deployments to insert')
    return 0
  }

  const deploymentsData = deploymentEntries.map(([location, bounds]) => ({
    deploymentID: location,
    locationID: location,
    locationName: location,
    deploymentStart: bounds.min,
    deploymentEnd: bounds.max,
    latitude: null,
    longitude: null,
    cameraModel: null,
    cameraID: null,
    coordinateUncertainty: null
  }))

  // Create bulk inserter for deployments table using raw SQL
  const sqlite = manager.getSqlite()
  const deploymentsColumns = [
    'deploymentID',
    'locationID',
    'locationName',
    'deploymentStart',
    'deploymentEnd',
    'latitude',
    'longitude',
    'cameraModel',
    'cameraID',
    'coordinateUncertainty'
  ]
  const deploymentsInserter = createBulkInserter(sqlite, 'deployments', deploymentsColumns)

  // Insert in batches using transaction-wrapped bulk insert
  const batchSize = CHUNK_SIZE
  for (let i = 0; i < deploymentsData.length; i += batchSize) {
    const batch = deploymentsData.slice(i, i + batchSize)
    deploymentsInserter(batch)
  }

  log.info(`Inserted ${deploymentsData.length} deployments`)
  return deploymentsData.length
}

/**
 * Streaming import for large LILA datasets
 * Uses JSONL temp file and in-memory bounds to avoid memory exhaustion
 */
async function importLilaDatasetStreaming(dataset, dbPath, id, onProgress) {
  log.info(`Starting STREAMING import for large dataset: ${dataset.id}`)

  const tempDir = path.join(os.tmpdir(), 'biowatch-lila-import')
  const tempJsonlPath = path.join(tempDir, `${id}-images.jsonl`)

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  // Download and extract metadata
  if (onProgress) {
    onProgress({
      stage: 'downloading',
      stageIndex: 0,
      totalStages: 3,
      datasetTitle: dataset.name
    })
  }

  const jsonPath = await downloadAndExtractMetadata(dataset, onProgress)
  log.info(`Downloaded metadata to: ${jsonPath}`)

  // In-memory Maps for bounds (small enough to keep in memory)
  const sequenceBounds = new Map() // seq_id → {start, end}
  const deploymentBounds = new Map() // location → {min, max}

  // Get database manager and Drizzle instance
  const manager = await getStudyDatabase(id, dbPath)
  const mainDb = manager.getDb()

  // Enable import mode for faster bulk inserts
  manager.setImportMode()

  try {
    // Stage 1: Stream categories (small, in-memory)
    if (onProgress) {
      onProgress({
        stage: 'parsing',
        stageIndex: 1,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: 'Extracting categories...'
      })
    }

    const categoryMap = await streamCategories(jsonPath)
    log.info(`Built category map with ${categoryMap.size} categories`)

    // Stage 2: Compute bounds + write JSONL (NO database inserts yet)
    if (onProgress) {
      onProgress({
        stage: 'parsing',
        stageIndex: 1,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: 'Computing bounds...'
      })
    }

    const imageCount = await computeBoundsAndWriteJsonl(
      jsonPath,
      tempJsonlPath,
      dataset,
      sequenceBounds,
      deploymentBounds,
      onProgress
    )
    log.info(`Processed ${imageCount} images, computed bounds`)

    // Count annotations (still part of parsing stage - scanning COCO JSON)
    const totalAnnotations = await countAnnotationsStreaming(jsonPath, (parsingProgress) => {
      if (onProgress) {
        onProgress({
          stage: 'parsing',
          stageIndex: 1,
          totalStages: 3,
          datasetTitle: dataset.name,
          parsingProgress
        })
      }
    })
    log.info(`Found ${totalAnnotations} annotations to import`)

    // Stage 3: Insert deployments FIRST (before media, to satisfy FK constraint)
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: 'Importing deployments...'
      })
    }

    const deploymentCount = await insertDeploymentsFromBounds(deploymentBounds, mainDb, manager)
    log.info(`Inserted ${deploymentCount} deployments`)

    // Stage 4: Insert media from JSONL (now FK to deployments is satisfied)
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: 'Importing media...'
      })
    }

    const mediaCount = await insertMediaFromJsonl(
      tempJsonlPath,
      mainDb,
      dataset,
      onProgress,
      manager
    )
    log.info(`Inserted ${mediaCount} media records`)

    // Stream annotations → observations inserts
    if (onProgress) {
      onProgress({
        stage: 'importing',
        stageIndex: 2,
        totalStages: 3,
        datasetTitle: dataset.name,
        detail: 'Importing observations...'
      })
    }

    const observationCount = await streamAnnotationsPass(
      jsonPath,
      tempJsonlPath,
      mainDb,
      categoryMap,
      sequenceBounds,
      dataset,
      totalAnnotations,
      onProgress,
      manager
    )
    log.info(`Streamed ${observationCount} observations`)

    // Insert metadata
    const metadataRecord = {
      id,
      name: dataset.name,
      title: dataset.name,
      description: dataset.longDescription || dataset.description,
      created: new Date().toISOString(),
      importerName: 'lila/coco',
      contributors: buildContributors(dataset),
      startDate: null,
      endDate: null,
      sequenceGap: DEFAULT_SEQUENCE_GAP
    }
    await insertMetadata(mainDb, metadataRecord)
    log.info('Inserted study metadata')

    // Signal completion
    if (onProgress) {
      onProgress({
        stage: 'complete',
        stageIndex: 3,
        totalStages: 3,
        datasetTitle: dataset.name
      })
    }

    log.info('STREAMING import completed successfully')

    return {
      dbPath,
      data: metadataRecord
    }
  } finally {
    // Reset import mode to safe defaults
    manager.resetImportMode()

    // Cleanup temp JSONL file
    try {
      if (fs.existsSync(tempJsonlPath)) {
        fs.unlinkSync(tempJsonlPath)
      }
      log.info('Cleaned up temporary JSONL file')
    } catch (cleanupError) {
      log.warn('Error cleaning up temp JSONL:', cleanupError)
    }
  }
}

/**
 * Download and extract metadata, returning path to JSON file
 * (Extracted from downloadAndParseMetadata for streaming use)
 */
async function downloadAndExtractMetadata(dataset, onProgress) {
  const tempDir = path.join(os.tmpdir(), 'biowatch-lila-import')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  if (dataset.isZipped) {
    const zipPath = path.join(tempDir, `${dataset.id}.zip`)
    await downloadFileWithRetry(dataset.metadataUrl, zipPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    const extractPath = path.join(tempDir, dataset.id)
    await extractZip(zipPath, extractPath)

    const jsonFile = findJsonFile(extractPath)
    if (!jsonFile) {
      throw new Error('No JSON file found in ZIP archive')
    }

    return jsonFile
  } else {
    const jsonPath = path.join(tempDir, `${dataset.id}.json`)
    await downloadFileWithRetry(dataset.metadataUrl, jsonPath, (progress) => {
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          stageIndex: 0,
          totalStages: 3,
          datasetTitle: dataset.name,
          downloadProgress: progress
        })
      }
    })

    return jsonPath
  }
}

// Threshold for using streaming import (100K images)
const STREAMING_THRESHOLD = 100000
