export const emptyHourSelection = () => ({ kind: 'chips', keys: [] })
export const defaultTimeFilter = () => ({ mode: 'solar', selection: emptyHourSelection() })

/** One state transition: no render/request can see old ranges under a new mode. */
export function switchTimeMode(state, mode) {
  if (!['clock', 'solar'].includes(mode)) throw new Error('Invalid time mode')
  return state.mode === mode ? state : { mode, selection: emptyHourSelection() }
}
