// Pure selection helpers for the Media tab's multi-select (grid + table).

// Toggle a single id in/out of the selection set, returning a new Set.
export function toggleSelection(current, id) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// Add the inclusive span of `order` between anchorId and targetId to `current`
// (shift-click range select). Direction-agnostic. If the anchor is unknown,
// falls back to just adding the target.
export function rangeSelection(current, order, anchorId, targetId) {
  const next = new Set(current)
  const i = order.indexOf(anchorId)
  const j = order.indexOf(targetId)
  if (i === -1 || j === -1) {
    next.add(targetId)
    return next
  }
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  for (let k = lo; k <= hi; k++) next.add(order[k])
  return next
}
