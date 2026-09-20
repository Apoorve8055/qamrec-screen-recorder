/**
 * Tracks active recording time, excluding pauses.
 * Uses wall-clock (epoch) time so events from other contexts (the page tracker)
 * can be mapped onto the recording timeline.
 */
export class RecordingClock {
  /** Active intervals in wall-clock ms; the last one may be open (end = null) */
  private intervals: { start: number; end: number | null }[] = [];
  private stopped = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  start(): void {
    this.intervals = [{ start: this.now(), end: null }];
    this.stopped = false;
  }

  pause(): void {
    const last = this.intervals[this.intervals.length - 1];
    if (last && last.end === null) last.end = this.now();
  }

  resume(): void {
    const last = this.intervals[this.intervals.length - 1];
    if (!this.stopped && last && last.end !== null) {
      this.intervals.push({ start: this.now(), end: null });
    }
  }

  stop(): void {
    this.pause();
    this.stopped = true;
  }

  isPaused(): boolean {
    const last = this.intervals[this.intervals.length - 1];
    return !!last && last.end !== null && !this.stopped;
  }

  /** Active ms recorded so far */
  elapsed(): number {
    const now = this.now();
    return this.intervals.reduce((sum, i) => sum + ((i.end ?? now) - i.start), 0);
  }

  /** Active time at a wall-clock instant, or null if not recording at that instant */
  activeTimeAt(wallTime: number): number | null {
    let acc = 0;
    for (const i of this.intervals) {
      const end = i.end ?? Infinity;
      if (wallTime < i.start) return null;
      if (wallTime <= end) return acc + (wallTime - i.start);
      acc += end - i.start;
    }
    return null;
  }
}
