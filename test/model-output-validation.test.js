import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  speciesnetRawOutputSchema,
  deepfauneRawOutputSchema,
  manasRawOutputSchema,
  rawOutputSchema
} from '../src/main/db/schemas.js'

describe('Model Output Zod Validation', () => {
  // ============================================================================
  // SpeciesNet Raw Output Schema Tests
  // ============================================================================

  describe('speciesnetRawOutputSchema', () => {
    test('should accept valid SpeciesNet output with all fields', () => {
      const validOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          classes: [
            '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
            '6c09fa63-2acc-4915-a60b-bd8cee40aedb;mammalia;lagomorpha;leporidae;;;rabbit and hare family'
          ],
          scores: [0.9893904328346252, 0.009531639516353607]
        },
        detections: [
          {
            category: '1',
            label: 'animal',
            conf: 0.9739366769790649,
            bbox: [0.334, 0.338, 0.26, 0.361]
          }
        ],
        prediction:
          '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
        prediction_score: 0.9893904328346252,
        prediction_source: 'classifier',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(validOutput)
      assert.equal(result.success, true, 'Should accept valid SpeciesNet output')
    })

    test('should accept SpeciesNet output with blank prediction (no classifications)', () => {
      const blankOutput = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(blankOutput)
      assert.equal(result.success, true, 'Should accept blank prediction')
    })

    test('should accept SpeciesNet output with multiple detections', () => {
      const multiDetectionOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          classes: ['class1', 'class2'],
          scores: [0.9, 0.1]
        },
        detections: [
          { category: '1', label: 'animal', conf: 0.95, bbox: [0.1, 0.2, 0.3, 0.4] },
          { category: '1', label: 'animal', conf: 0.03, bbox: [0.5, 0.6, 0.2, 0.2] }
        ],
        prediction: 'class1',
        prediction_score: 0.9,
        prediction_source: 'classifier',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(multiDetectionOutput)
      assert.equal(result.success, true, 'Should accept multiple detections')
    })

    test('should reject SpeciesNet output without filepath', () => {
      const noFilepath = {
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(noFilepath)
      assert.equal(result.success, false, 'Should reject missing filepath')
    })

    test('should reject SpeciesNet output without prediction', () => {
      const noPrediction = {
        filepath: '/path/to/image.JPG',
        detections: [],
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(noPrediction)
      assert.equal(result.success, false, 'Should reject missing prediction')
    })

    test('should reject SpeciesNet output without model_version', () => {
      const noVersion = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'blank'
      }

      const result = speciesnetRawOutputSchema.safeParse(noVersion)
      assert.equal(result.success, false, 'Should reject missing model_version')
    })

    test('should reject invalid bbox format (wrong tuple length)', () => {
      const invalidBbox = {
        filepath: '/path/to/image.JPG',
        detections: [{ category: '1', label: 'animal', conf: 0.9, bbox: [0.1, 0.2, 0.3] }],
        prediction: 'test',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(invalidBbox)
      assert.equal(result.success, false, 'Should reject invalid bbox length')
    })

    test('should reject confidence score outside 0-1 range', () => {
      const invalidConf = {
        filepath: '/path/to/image.JPG',
        detections: [{ category: '1', label: 'animal', conf: 1.5, bbox: [0.1, 0.2, 0.3, 0.4] }],
        prediction: 'test',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(invalidConf)
      assert.equal(result.success, false, 'Should reject conf > 1')
    })

    test('should reject negative confidence score', () => {
      const negativeConf = {
        filepath: '/path/to/image.JPG',
        detections: [{ category: '1', label: 'animal', conf: -0.1, bbox: [0.1, 0.2, 0.3, 0.4] }],
        prediction: 'test',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(negativeConf)
      assert.equal(result.success, false, 'Should reject negative conf')
    })

    test('should reject prediction_score outside 0-1 range', () => {
      const invalidPredScore = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'test',
        prediction_score: 1.5,
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(invalidPredScore)
      assert.equal(result.success, false, 'Should reject prediction_score > 1')
    })
  })

  // ============================================================================
  // DeepFaune Raw Output Schema Tests
  // ============================================================================

  describe('deepfauneRawOutputSchema', () => {
    test('should accept valid DeepFaune output with all fields', () => {
      const validOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          labels: ['chamois', 'marmot', 'blank'],
          scores: [0.999, 0.0001, 0.0]
        },
        detections: [
          {
            class: 0,
            label: 'animal',
            conf: 0.982,
            xywhn: [0.22, 0.52, 0.44, 0.85],
            xyxy: [0.06, 76.5, 441.6, 713.3]
          }
        ],
        prediction: 'chamois',
        prediction_score: 0.999,
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(validOutput)
      assert.equal(result.success, true, 'Should accept valid DeepFaune output')
    })

    test('should accept DeepFaune output with blank prediction', () => {
      const blankOutput = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'blank',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(blankOutput)
      assert.equal(result.success, true, 'Should accept blank prediction')
    })

    test('should accept DeepFaune output with "vide" prediction', () => {
      const videOutput = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'vide',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(videOutput)
      assert.equal(result.success, true, 'Should accept "vide" prediction')
    })

    test('should reject DeepFaune output without filepath', () => {
      const noFilepath = {
        detections: [],
        prediction: 'chamois',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(noFilepath)
      assert.equal(result.success, false, 'Should reject missing filepath')
    })

    test('should reject invalid xywhn format (wrong tuple length)', () => {
      const invalidXywhn = {
        filepath: '/path/to/image.JPG',
        detections: [
          {
            class: 0,
            label: 'animal',
            conf: 0.9,
            xywhn: [0.1, 0.2, 0.3], // Missing one value
            xyxy: [0.1, 0.2, 0.3, 0.4]
          }
        ],
        prediction: 'test',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(invalidXywhn)
      assert.equal(result.success, false, 'Should reject invalid xywhn length')
    })

    test('should reject non-integer class value', () => {
      const floatClass = {
        filepath: '/path/to/image.JPG',
        detections: [
          {
            class: 0.5,
            label: 'animal',
            conf: 0.9,
            xywhn: [0.1, 0.2, 0.3, 0.4],
            xyxy: [0.1, 0.2, 0.3, 0.4]
          }
        ],
        prediction: 'test',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(floatClass)
      assert.equal(result.success, false, 'Should reject non-integer class')
    })
  })

  // ============================================================================
  // Manas Raw Output Schema Tests
  // ============================================================================

  describe('manasRawOutputSchema', () => {
    test('should accept valid Manas output (same structure as DeepFaune)', () => {
      const validOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          labels: ['panthera_uncia', 'panthera_pardus'],
          scores: [0.95, 0.05]
        },
        detections: [
          {
            class: 0,
            label: 'animal',
            conf: 0.98,
            xywhn: [0.5, 0.5, 0.6, 0.8],
            xyxy: [100, 50, 400, 450]
          }
        ],
        prediction: 'panthera_uncia',
        prediction_score: 0.95,
        model_version: '1.0'
      }

      const result = manasRawOutputSchema.safeParse(validOutput)
      assert.equal(result.success, true, 'Should accept valid Manas output')
    })
  })

  // ============================================================================
  // Polymorphic rawOutputSchema Tests
  // ============================================================================

  describe('rawOutputSchema (permissive)', () => {
    test('should accept null', () => {
      const result = rawOutputSchema.safeParse(null)
      assert.equal(result.success, true, 'Should accept null rawOutput')
      assert.equal(result.data, null)
    })

    test('should accept valid SpeciesNet format', () => {
      const speciesnetOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          classes: ['class1'],
          scores: [0.9]
        },
        detections: [{ category: '1', label: 'animal', conf: 0.9, bbox: [0.1, 0.2, 0.3, 0.4] }],
        prediction: 'class1',
        prediction_score: 0.9,
        prediction_source: 'classifier',
        model_version: '4.0.1a'
      }

      const result = rawOutputSchema.safeParse(speciesnetOutput)
      assert.equal(result.success, true, 'Should accept SpeciesNet format')
    })

    test('should accept valid DeepFaune format', () => {
      const deepfauneOutput = {
        filepath: '/path/to/image.JPG',
        classifications: {
          labels: ['chamois'],
          scores: [0.9]
        },
        detections: [
          {
            class: 0,
            label: 'animal',
            conf: 0.9,
            xywhn: [0.1, 0.2, 0.3, 0.4],
            xyxy: [10, 20, 30, 40]
          }
        ],
        prediction: 'chamois',
        prediction_score: 0.9,
        model_version: '1.3'
      }

      const result = rawOutputSchema.safeParse(deepfauneOutput)
      assert.equal(result.success, true, 'Should accept DeepFaune format')
    })

    test('should accept output with empty classifications object', () => {
      const emptyClassifications = {
        filepath: '/path/to/image.JPG',
        classifications: {}, // Empty object - this was causing the error
        detections: [],
        prediction: 'chamois',
        model_version: '1.3'
      }

      const result = rawOutputSchema.safeParse(emptyClassifications)
      assert.equal(result.success, true, 'Should accept empty classifications object')
    })

    test('should accept output without classifications field', () => {
      const noClassifications = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'blank',
        model_version: '1.3'
      }

      const result = rawOutputSchema.safeParse(noClassifications)
      assert.equal(result.success, true, 'Should accept missing classifications')
    })

    test('should reject completely invalid structure', () => {
      const invalidOutput = {
        foo: 'bar',
        baz: 123
      }

      const result = rawOutputSchema.safeParse(invalidOutput)
      assert.equal(result.success, false, 'Should reject invalid structure')
    })

    test('should reject undefined', () => {
      const result = rawOutputSchema.safeParse(undefined)
      assert.equal(result.success, false, 'Should reject undefined')
    })

    test('should reject array instead of object', () => {
      const arrayOutput = [{ filepath: '/path', prediction: 'test', model_version: '1.0' }]

      const result = rawOutputSchema.safeParse(arrayOutput)
      assert.equal(result.success, false, 'Should reject array')
    })

    test('should reject string instead of object', () => {
      const stringOutput = 'not an object'

      const result = rawOutputSchema.safeParse(stringOutput)
      assert.equal(result.success, false, 'Should reject string')
    })
  })

  // ============================================================================
  // Edge Cases and Real-World Scenarios
  // ============================================================================

  describe('Edge cases', () => {
    test('should accept SpeciesNet output with empty detections array', () => {
      const emptyDetections = {
        filepath: '/path/to/image.JPG',
        classifications: {
          classes: ['blank'],
          scores: [1.0]
        },
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(emptyDetections)
      assert.equal(result.success, true, 'Should accept empty detections')
    })

    test('should accept DeepFaune output with empty detections array', () => {
      const emptyDetections = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'empty',
        model_version: '1.3'
      }

      const result = deepfauneRawOutputSchema.safeParse(emptyDetections)
      assert.equal(result.success, true, 'Should accept empty detections')
    })

    test('should accept filepath with special characters', () => {
      const specialPath = {
        filepath: '/path/with spaces/and-dashes/image_001.JPG',
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(specialPath)
      assert.equal(result.success, true, 'Should accept filepath with special chars')
    })

    test('should accept Windows-style filepath', () => {
      const windowsPath = {
        filepath: 'C:\\Users\\User\\Images\\photo.jpg',
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(windowsPath)
      assert.equal(result.success, true, 'Should accept Windows-style path')
    })

    test('should accept confidence score of exactly 0', () => {
      const zeroConf = {
        filepath: '/path/to/image.JPG',
        detections: [{ category: '1', label: 'animal', conf: 0, bbox: [0.1, 0.2, 0.3, 0.4] }],
        prediction: 'test',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(zeroConf)
      assert.equal(result.success, true, 'Should accept conf = 0')
    })

    test('should accept confidence score of exactly 1', () => {
      const perfectConf = {
        filepath: '/path/to/image.JPG',
        detections: [{ category: '1', label: 'animal', conf: 1, bbox: [0.1, 0.2, 0.3, 0.4] }],
        prediction: 'test',
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(perfectConf)
      assert.equal(result.success, true, 'Should accept conf = 1')
    })

    test('should accept prediction_score of exactly 0', () => {
      const zeroPredScore = {
        filepath: '/path/to/image.JPG',
        detections: [],
        prediction: 'blank',
        prediction_score: 0,
        model_version: '4.0.1a'
      }

      const result = speciesnetRawOutputSchema.safeParse(zeroPredScore)
      assert.equal(result.success, true, 'Should accept prediction_score = 0')
    })
  })

  // ============================================================================
  // Integration Tests with Real Model Outputs
  // ============================================================================

  describe('Integration tests with real model outputs', () => {
    test('should accept real SpeciesNet output (from importer.js)', () => {
      // Real output from SpeciesNet model (copied from importer.js comments)
      const realSpeciesnetOutput = {
        filepath: '/Users/iorek/Downloads/species/0b87ee8f-bf2c-4154-82fd-500b3a8b88ae.JPG',
        classifications: {
          classes: [
            '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
            '6c09fa63-2acc-4915-a60b-bd8cee40aedb;mammalia;lagomorpha;leporidae;;;rabbit and hare family',
            'ce9a5481-b3f7-4e42-8b8b-382f601fded0;mammalia;lagomorpha;leporidae;lepus;europaeus;european hare',
            '667a4650-a141-4c4e-844e-58cdeaeb4ae1;mammalia;lagomorpha;leporidae;sylvilagus;floridanus;eastern cottontail',
            'cacc63d7-b949-4731-abce-a403ba76ee34;mammalia;lagomorpha;leporidae;sylvilagus;;sylvilagus species'
          ],
          scores: [
            0.9893904328346252, 0.009531639516353607, 0.00039335378096438944,
            0.00019710895139724016, 0.00010050772834802046
          ]
        },
        detections: [
          {
            category: '1',
            label: 'animal',
            conf: 0.9739366769790649,
            bbox: [0.334, 0.338, 0.26, 0.361]
          },
          {
            category: '1',
            label: 'animal',
            conf: 0.029717758297920227,
            bbox: [0.1, 0.2, 0.15, 0.2]
          }
        ],
        prediction:
          '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
        prediction_score: 0.9893904328346252,
        prediction_source: 'classifier',
        model_version: '4.0.1a'
      }

      const result = rawOutputSchema.safeParse(realSpeciesnetOutput)
      assert.equal(result.success, true, 'Should accept real SpeciesNet output')
    })

    test('should accept real DeepFaune output (from run_deepfaune_server.py)', () => {
      // Real output from DeepFaune model (copied from server documentation)
      const realDeepfauneOutput = {
        classifications: {
          labels: ['chamois', 'marmot', 'ibex', 'badger', 'wildcat'],
          scores: [
            0.9999195337295532, 0.00003937631774460897, 0.000007861674930609297,
            0.000004211383838992333, 0.0000040040545172814745
          ]
        },
        detections: [
          {
            class: 0,
            conf: 0.9823879599571228,
            label: 'animal',
            xywhn: [
              0.22008246183395386, 0.5234066247940063, 0.4399449825286865, 0.8540064692497253
            ],
            xyxy: [0.06298828125, 76.50860595703125, 441.640380859375, 713.3292846679688]
          }
        ],
        filepath:
          '/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/chamois1.JPG',
        model_version: '1.3',
        prediction: 'chamois',
        prediction_score: 0.9999195337295532
      }

      const result = rawOutputSchema.safeParse(realDeepfauneOutput)
      assert.equal(result.success, true, 'Should accept real DeepFaune output')
    })

    test('should accept DeepFaune blank/empty prediction', () => {
      // DeepFaune output when no animal is detected
      const blankDeepfauneOutput = {
        classifications: {},
        detections: [],
        filepath: '/path/to/empty_image.JPG',
        model_version: '1.3',
        prediction: 'blank',
        prediction_score: 0.0
      }

      const result = rawOutputSchema.safeParse(blankDeepfauneOutput)
      assert.equal(result.success, true, 'Should accept DeepFaune blank prediction')
    })

    test('should accept SpeciesNet blank prediction', () => {
      // SpeciesNet output when no animal is detected
      const blankSpeciesnetOutput = {
        filepath: '/path/to/empty_image.JPG',
        classifications: {},
        detections: [],
        prediction: 'blank',
        model_version: '4.0.1a'
      }

      const result = rawOutputSchema.safeParse(blankSpeciesnetOutput)
      assert.equal(result.success, true, 'Should accept SpeciesNet blank prediction')
    })

    test('should accept Manas output (similar to DeepFaune)', () => {
      // Manas model output for snow leopard detection
      const realManasOutput = {
        classifications: {
          labels: ['panthera_uncia', 'panthera_pardus', 'blank'],
          scores: [0.95, 0.03, 0.02]
        },
        detections: [
          {
            class: 0,
            conf: 0.98,
            label: 'animal',
            xywhn: [0.5, 0.5, 0.6, 0.8],
            xyxy: [100, 50, 400, 450]
          }
        ],
        filepath: '/path/to/snow_leopard.JPG',
        model_version: '1.0',
        prediction: 'panthera_uncia',
        prediction_score: 0.95
      }

      const result = rawOutputSchema.safeParse(realManasOutput)
      assert.equal(result.success, true, 'Should accept real Manas output')
    })

    test('should accept output with multiple detections (multi-animal scene)', () => {
      // Scene with multiple animals detected
      const multiDetectionOutput = {
        filepath: '/path/to/multi_animal.JPG',
        classifications: {
          labels: ['deer', 'rabbit'],
          scores: [0.7, 0.3]
        },
        detections: [
          {
            class: 0,
            label: 'animal',
            conf: 0.95,
            xywhn: [0.2, 0.3, 0.3, 0.4],
            xyxy: [10, 20, 30, 40]
          },
          {
            class: 0,
            label: 'animal',
            conf: 0.88,
            xywhn: [0.6, 0.5, 0.2, 0.3],
            xyxy: [50, 60, 70, 80]
          },
          {
            class: 0,
            label: 'animal',
            conf: 0.72,
            xywhn: [0.1, 0.8, 0.15, 0.2],
            xyxy: [5, 90, 15, 100]
          }
        ],
        prediction: 'deer',
        prediction_score: 0.7,
        model_version: '1.3'
      }

      const result = rawOutputSchema.safeParse(multiDetectionOutput)
      assert.equal(result.success, true, 'Should accept multi-detection output')
    })
  })
})
