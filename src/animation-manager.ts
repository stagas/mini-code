export type AnimationCallback = (timestamp: number) => void

export interface AnimationEntry {
  id: string
  callback: AnimationCallback
  priority?: number // Lower numbers = higher priority
}

export class AnimationManager {
  private rafId: number | null = null
  private entries = new Map<string, AnimationEntry>()
  private isRunning = false
  private lastTimestamp = 0
  private lastErrorLogTime = new Map<string, number>()

  private readonly animateFrame = (timestamp: number): void => {
    if (!this.isRunning) return

    // Sort entries by priority (lower priority number = higher priority)
    const sortedEntries = Array.from(this.entries.values()).sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    )

    // Call all registered callbacks, but never let one bad callback stall the RAF loop.
    for (const entry of sortedEntries) {
      try {
        entry.callback(timestamp)
      }
      catch (err) {
        // Throttle logs to avoid flooding the console (especially if a callback throws every frame).
        const now = performance.now()
        const last = this.lastErrorLogTime.get(entry.id) ?? 0
        if (now - last > 1000) {
          this.lastErrorLogTime.set(entry.id, now)
          console.error(`[AnimationManager] callback "${entry.id}" threw`, err)
        }
      }
    }

    this.lastTimestamp = timestamp

    // Continue the loop if we still have entries
    if (this.entries.size > 0) {
      this.rafId = requestAnimationFrame(this.animateFrame)
    }
    else {
      this.isRunning = false
      this.rafId = null
    }
  }

  /**
   * Register an animation callback. If already registered, it will be updated.
   */
  register(id: string, callback: AnimationCallback, priority = 0): void {
    this.entries.set(id, { id, callback, priority })

    if (!this.isRunning) {
      this.start()
    }
    else if (this.rafId === null) {
      // Defensive: if we ever end up "running" but without a scheduled RAF (e.g. due to an exception),
      // reschedule it so draws don't get stuck until user interaction.
      this.rafId = requestAnimationFrame(this.animateFrame)
    }
  }

  /**
   * Unregister an animation callback
   */
  unregister(id: string): void {
    this.entries.delete(id)

    if (this.entries.size === 0 && this.isRunning) {
      this.stop()
    }
  }

  /**
   * Check if an animation is registered
   */
  isRegistered(id: string): boolean {
    return this.entries.has(id)
  }

  /**
   * Schedule a callback to run after a specific number of frames
   */
  scheduleFrames(id: string, callback: AnimationCallback, frames: number): void {
    if (frames <= 0) {
      callback(performance.now())
      return
    }

    let remainingFrames = frames
    const scheduledCallback = (timestamp: number) => {
      remainingFrames--
      if (remainingFrames <= 0) {
        this.unregister(id)
        callback(timestamp)
      }
    }

    this.register(id, scheduledCallback)
  }

  /**
   * Schedule a callback to run on the next frame
   */
  nextFrame(id: string, callback: AnimationCallback): void {
    this.scheduleFrames(id, callback, 1)
  }

  /**
   * Start the animation loop if not already running
   */
  private start(): void {
    if (this.isRunning) return

    this.isRunning = true
    this.lastTimestamp = performance.now()
    this.rafId = requestAnimationFrame(this.animateFrame)
  }

  /**
   * Stop the animation loop
   */
  private stop(): void {
    if (!this.isRunning) return

    this.isRunning = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  // (animation loop implementation moved to `animateFrame` to avoid `bind()` allocations and to harden against exceptions)

  /**
   * Get the number of registered animations
   */
  getAnimationCount(): number {
    return this.entries.size
  }

  /**
   * Check if the animation loop is running
   */
  isAnimationRunning(): boolean {
    return this.isRunning
  }
}

// Global singleton instance
export const animationManager = new AnimationManager()
