// Presenter mode (rule 3): bigger text and dimmed chrome for a second screen. A local toggle only; never a network default.
const KEY = 'meridian-presenter'

export function getPresenter() {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setPresenter(on) {
  try {
    if (on) globalThis.localStorage?.setItem(KEY, '1')
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    /* private mode: presenter toggle simply does not persist */
  }
  document.documentElement.classList.toggle('presenter', on)
}
