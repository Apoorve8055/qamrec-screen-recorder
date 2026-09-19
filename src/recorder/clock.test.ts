import { describe, it, expect } from 'vitest';
import { RecordingClock } from './clock';

function fakeNow(start = 1000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('RecordingClock', () => {
  it('is zero before starting', () => {
    const t = fakeNow();
    const clock = new RecordingClock(t.now);
    expect(clock.elapsed()).toBe(0);
  });

  it('accumulates active time across pause and resume', () => {
    const t = fakeNow();
    const clock = new RecordingClock(t.now);
    clock.start();
    t.advance(3000);
    clock.pause();
    t.advance(10_000);
    expect(clock.elapsed()).toBe(3000);
    clock.resume();
    t.advance(2000);
    expect(clock.elapsed()).toBe(5000);
  });

  it('freezes after stop', () => {
    const t = fakeNow();
    const clock = new RecordingClock(t.now);
    clock.start();
    t.advance(1500);
    clock.stop();
    t.advance(5000);
    expect(clock.elapsed()).toBe(1500);
  });

  it('maps wall-clock instants to active time', () => {
    const t = fakeNow(0);
    const clock = new RecordingClock(t.now);
    clock.start(); // wall 0
    t.advance(2000);
    clock.pause(); // wall 2000
    t.advance(1000);
    clock.resume(); // wall 3000
    t.advance(1000);

    expect(clock.activeTimeAt(1000)).toBe(1000);
    expect(clock.activeTimeAt(2500)).toBeNull(); // during pause
    expect(clock.activeTimeAt(3500)).toBe(2500);
    expect(clock.activeTimeAt(-5)).toBeNull(); // before start
  });

  it('ignores pause when not recording and resume when not paused', () => {
    const t = fakeNow();
    const clock = new RecordingClock(t.now);
    clock.pause();
    clock.start();
    clock.resume();
    t.advance(100);
    expect(clock.elapsed()).toBe(100);
    expect(clock.isPaused()).toBe(false);
  });
});
