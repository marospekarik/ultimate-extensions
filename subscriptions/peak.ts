/**
 * Ollama Cloud's peak hours: "Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends"
 * (https://ollama.com/pricing), and every cloud model's off-peak rate is half its peak rate. Since a plan counts dollars
 * of credit, the same work burns twice the allowance inside the window.
 */
const START = 12
const END = 18
const HOUR = 3_600_000
const WEEK = 7 * 24 * HOUR

const weekday = (at: number) => {
  const day = new Date(at).getUTCDay()
  return day !== 0 && day !== 6
}

/** The next hour that starts a peak window, strictly after `at`. */
function nextStart(at: number): number | undefined {
  for (let hour = Math.floor(at / HOUR) + 1; hour * HOUR <= at + WEEK; hour++) {
    const start = hour * HOUR
    if (weekday(start) && new Date(start).getUTCHours() === START) return start
  }
  return undefined
}

/** Whether `at` is inside peak hours, with the edges around it: when it ends, and when the next one begins. */
export function peak(at: number): { on: boolean; until?: number; from?: number } {
  const hour = new Date(at).getUTCHours()
  if (weekday(at) && hour >= START && hour < END) {
    const until = new Date(at)
    until.setUTCHours(END, 0, 0, 0)
    return { on: true, until: until.getTime(), from: nextStart(until.getTime()) }
  }
  return { on: false, from: nextStart(at) }
}
