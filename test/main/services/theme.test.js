import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { createThemeService } from '../../../src/main/services/theme.js'

function makeMocks() {
  const fakeNativeTheme = {
    themeSource: 'system',
    shouldUseDarkColors: false,
    _listeners: [],
    on(event, fn) {
      if (event === 'updated') this._listeners.push(fn)
    },
    _emitUpdated() {
      for (const fn of this._listeners) fn()
    }
  }
  let stored = {}
  const fakeStore = {
    read: () => stored,
    write: (next) => {
      stored = next
    }
  }
  const broadcasts = []
  const broadcast = (event, payload) => broadcasts.push({ event, payload })
  return { fakeNativeTheme, fakeStore, broadcasts, broadcast, getStored: () => stored }
}

describe('theme service', () => {
  test('init reads source from store and applies to nativeTheme', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    fakeStore.write({ theme: { source: 'dark' } })
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.equal(fakeNativeTheme.themeSource, 'dark')
  })

  test('init defaults to system when nothing stored', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.equal(fakeNativeTheme.themeSource, 'system')
  })

  test('getResolved returns dark when shouldUseDarkColors true', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    fakeNativeTheme.shouldUseDarkColors = true
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    assert.equal(svc.getResolved(), 'dark')
  })

  test('getResolved returns light when shouldUseDarkColors false', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    assert.equal(svc.getResolved(), 'light')
  })

  test('setSource updates nativeTheme, persists, and broadcasts', () => {
    const { fakeNativeTheme, fakeStore, broadcasts, broadcast, getStored } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    svc.setSource('dark')
    assert.equal(fakeNativeTheme.themeSource, 'dark')
    assert.deepEqual(getStored(), { theme: { source: 'dark' } })
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].event, 'theme:changed')
    assert.deepEqual(broadcasts[0].payload, { source: 'dark', resolved: 'light' })
  })

  test('setSource rejects invalid values', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.throws(() => svc.setSource('blue'), /invalid theme source/i)
  })

  test('OS update event triggers a broadcast', () => {
    const { fakeNativeTheme, fakeStore, broadcasts, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    fakeNativeTheme.shouldUseDarkColors = true
    fakeNativeTheme._emitUpdated()
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].event, 'theme:changed')
    assert.deepEqual(broadcasts[0].payload, { source: 'system', resolved: 'dark' })
  })

  test('setSource persists alongside other preferences', () => {
    const { fakeNativeTheme, fakeStore, broadcast, getStored } = makeMocks()
    fakeStore.write({ otherStuff: 'keep' })
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    svc.setSource('light')
    assert.deepEqual(getStored(), { otherStuff: 'keep', theme: { source: 'light' } })
  })
})
