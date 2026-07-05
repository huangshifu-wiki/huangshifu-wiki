/**
 * Custom hook kept for API compatibility. The site intentionally keeps motion enabled
 * instead of following the operating system reduced-motion preference.
 * @returns A tuple containing [prefersReducedMotion, setReducedMotion]
 * - prefersReducedMotion: always false
 * - setReducedMotion: no-op compatibility function
 */
export const useReducedMotion = (): [boolean, (value: boolean) => void] => {
  return [false, () => undefined]
}

/**
 * Type definition for the return value of useReducedMotion hook
 */
export type UseReducedMotionReturn = [boolean, (value: boolean) => void]
