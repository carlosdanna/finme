import * as React from "react"

/** Tailwind's `md`. Below this the UI is the phone layout, which is the design
 *  target — see BUILD-PLAN Part 2b. */
const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // Server / prerender fallback: assume the phone layout, since that is the
    // design target rather than the exception.
    () => true,
  )
}
