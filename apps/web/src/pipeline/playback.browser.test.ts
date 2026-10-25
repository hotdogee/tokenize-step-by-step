/**
 * The playback controller and the rail in chromium (05 §2, §3.5, §8): the step-duration clamp and the three speeds,
 * replay scoped to the focused chunk (byte-level) or a 2,000-byte window (spm) above 2,000 steps with the scope stated
 * in the rail's status line (and a truncated timeline's), a scope that follows a keyboard step past its end, playback
 * over a manual clock (start, one step per tick, stop at the scope's end, restart), and the rail's controls: six named
 * radios, Space on the scrubber, Home/End, a fixed `aria-valuetext` while playing, the stop-6 step rule (and the step
 * kept while no result matches), follow mode (off on any manual scroll, back on only with "jump to end"), and the merge
 * list (one tab stop, arrow keys, scrolls itself and never the page).
 */
import '../theme/base.css';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { appWith, fixtureResult, frames } from '../board/board.test-helper.ts';
import { Playback } from './playback.svelte.ts';
import { longResult, manualClock, mountRail, type MountedRail } from './pipeline.test-helper.ts';
import { positionOf, replayScope, SCOPE_LIMIT, scopeTicks, stepAt, stepDuration } from './scope.ts';

let mounted: MountedRail | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  vi.restoreAllMocks();
});

describe('step duration: clamp(60 ms, 12 s / steps, 450 ms) ÷ speed', () => {
  it('clamps to 450 ms for short timelines and 60 ms for long ones', () => {
    expect(stepDuration(1, 1)).toBe(450);
    expect(stepDuration(8, 1)).toBe(450);
    expect(stepDuration(100, 1)).toBe(120);
    expect(stepDuration(200, 1)).toBe(60);
    expect(stepDuration(2000, 1)).toBe(60);
    expect(stepDuration(0, 1)).toBe(450);
  });

  it('scales by the speed (×0.5 doubles, ×2 halves)', () => {
    expect(stepDuration(100, 0.5)).toBe(240);
    expect(stepDuration(100, 2)).toBe(60);
    expect(stepDuration(1000, 2)).toBe(30);
    expect(stepDuration(1, 0.5)).toBe(900);
  });
});

describe('replay scope (05 §2)', () => {
  it('replays the whole timeline up to 2,000 steps', () => {
    const result = longResult(SCOPE_LIMIT / 4); // 1,500 steps
    const scope = replayScope(result, 0);
    expect(scope.kind).toBe('all');
    expect(scope.count).toBe(1500);
    expect(stepAt(scope, 0)).toBe(0);
    expect(stepAt(scope, 1500)).toBe(1500);
  });

  it('byte-level above 2,000 steps: the focused chunk only, contiguous', () => {
    const result = longResult(800); // 2,400 steps over 800 chunks
    const scope = replayScope(result, 4 * 10 + 1); // a byte of chunk 10
    expect(scope).toMatchObject({ kind: 'chunk', chunk: 10, chunks: 800, count: 3, first: 31 });
    expect([0, 1, 2, 3].map((p) => stepAt(scope, p))).toEqual([30, 31, 32, 33]);
    expect(positionOf(scope, 32)).toBe(2);
    expect(positionOf(scope, 5)).toBe(0); // before the chunk: clamped to its start
    expect(positionOf(scope, 2400)).toBe(3);
  });

  it('spm above 2,000 steps: the steps inside a 2,000-byte window around the focused byte', () => {
    const result = longResult(1000, 'spm-bpe'); // 3,000 steps, 4,000 bytes, one global sequence
    const scope = replayScope(result, 2000);
    expect(scope).toMatchObject({ kind: 'window', start: 1000, end: 3000 });
    expect(scope.count).toBe(1500); // 500 words × 3 steps, all inside [1000, 3000)
    expect(stepAt(scope, 0)).toBe(750); // the step before the window's first (751)
    expect(stepAt(scope, 1)).toBe(751);
    expect(stepAt(scope, 1500)).toBe(2250);
    expect(positionOf(scope, 760)).toBe(10);
  });

  it('puts ticks on chunk boundaries (none above the tick cap)', () => {
    const cl100k = fixtureResult('openai-cl100k_base', 'mixed-hello-taiwan-tokyo');
    const scope = replayScope(cl100k, 0);
    const ticks = scopeTicks(cl100k, scope);
    const timeline = cl100k.timeline;
    expect(timeline).not.toBeNull();
    for (const p of ticks) expect(timeline?.stepChunk[p - 1]).not.toBe(timeline?.stepChunk[p]);
    expect(scopeTicks(longResult(400), replayScope(longResult(400), 0))).toEqual([]); // 399 boundaries > cap
  });
});

describe('playback controller over a manual clock', () => {
  it('starts from step 0 off stop 5, steps once per tick, stops at the end and restarts', () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'));
    const count = app.stepCount;
    expect(count).toBeGreaterThan(2);
    const clock = manualClock();
    const playback = new Playback(app, () => replayScope(app.result ?? longResult(1), 0), clock);
    playback.play();
    expect(app).toMatchObject({ stage: 5, step: 0, playing: true });
    expect(clock.pending()).toBe(stepDuration(count, 1));
    clock.advance();
    expect(app.step).toBe(1);
    app.speed = 2;
    clock.advance();
    expect(app.step).toBe(2);
    expect(clock.pending()).toBe(stepDuration(count, 2));
    app.step = count - 1; // a manual step while playing: playback continues from there
    clock.advance();
    expect(app).toMatchObject({ step: count, playing: false });
    expect(clock.pending()).toBeNull();
    playback.play(); // at the end: restart
    expect(app.step).toBe(0);
    playback.pause();
    expect(app.playing).toBe(false);
    expect(clock.pending()).toBeNull();
  });

  it('plays only the scoped chunk above 2,000 steps', () => {
    const result = longResult(800);
    const app = appWith(result, { stage: 5, step: 0 });
    const clock = manualClock();
    const scope = replayScope(result, 4 * 20);
    const playback = new Playback(app, () => scope, clock);
    playback.play();
    expect(app.step).toBe(60); // chunk 20 starts after 60 steps
    expect(clock.pending()).toBe(stepDuration(3, 1));
    clock.advance();
    clock.advance();
    clock.advance();
    expect(app).toMatchObject({ step: 63, playing: false });
  });
});

describe('the rail (05 §3.5 ARIA table, §8 keys)', () => {
  it('is a radiogroup of six stops named "n of 6: name" with the current one checked', async () => {
    mounted = await mountRail(appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 3 }), {
      motion: false,
    });
    const group = mounted.rail.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('pipeline stage');
    const radios = [...mounted.rail.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      '1 of 6: Text',
      '2 of 6: Code points',
      '3 of 6: UTF-8 bytes',
      '4 of 6: Chunks',
      '5 of 6: Merges',
      '6 of 6: Tokens',
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['3']);
    radios[2]?.focus();
    await userEvent.keyboard('{ArrowRight}');
    await frames(1);
    expect(mounted.app.stage).toBe(4);
  });

  it('keeps the step at the step count on stop 6, so "[" shows the last merge at stop 5', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 6, step: 0 });
    mounted = await mountRail(app, { motion: false });
    expect(app.step).toBe(app.stepCount);
    app.moveStage(-1);
    flushSync();
    expect(app).toMatchObject({ stage: 5, step: app.stepCount });
  });

  it('plays and pauses with Space on the scrubber; Home/End go to the first/last step', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 5, step: 3 });
    mounted = await mountRail(app, { motion: false });
    const scrubber = mounted.rail.querySelector<HTMLInputElement>('[data-testid="scrubber"]');
    scrubber?.focus();
    expect(scrubber?.getAttribute('aria-valuetext')).toMatch(/^step 3 \/ \d+ · [0-9A-F ]+ \+ [0-9A-F ]+ → \d+ \(/);
    await userEvent.keyboard(' ');
    expect(app.playing).toBe(true);
    await userEvent.keyboard(' ');
    expect(app.playing).toBe(false);
    await userEvent.keyboard('{Home}');
    await frames(1);
    expect(app.step).toBe(0);
    expect(scrubber?.getAttribute('aria-valuetext')).toMatch(/^step 0 \/ \d+ · no merges yet$/);
    await userEvent.keyboard('{End}');
    await frames(1);
    expect(app).toMatchObject({ stage: 5, step: app.stepCount });
  });

  it('keeps the merged part in view until a manual scroll, and again after "jump to end"', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 5, step: 2 });
    mounted = await mountRail(app, { motion: false });
    const scrolls: unknown[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation((options) => {
      scrolls.push(options);
    });
    app.step = 3;
    flushSync();
    expect(scrolls).toHaveLength(1); // follow mode
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
    app.step = 4;
    flushSync();
    expect(scrolls).toHaveLength(1); // off after a manual scroll
    const scrubber = mounted.rail.querySelector<HTMLInputElement>('[data-testid="scrubber"]');
    scrubber?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })); // over the rail: not a board scroll
    scrubber?.focus();
    await userEvent.keyboard('{End}'); // jump to end: on again
    await frames(1);
    expect(app.step).toBe(app.stepCount);
    expect(scrolls).toHaveLength(2);
  });

  it('states a scoped replay in its status line', async () => {
    const result = longResult(800);
    const app = appWith(result, { stage: 5, step: 0 });
    app.focus = { tier: 'char', byte: 4 * 6 };
    mounted = await mountRail(app, { motion: false });
    const status = mounted.rail.querySelector('[data-testid="scope-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('replaying chunk 7 of 800');
    expect(mounted.rail.querySelector('[data-testid="scrubber"]')?.getAttribute('max')).toBe('3');
  });
});

describe('the rail: scope lines, scope following, playing value, the kept step', () => {
  it('states a truncated timeline ("merge replay limited to the first N steps")', async () => {
    const result = longResult(100, 'bytelevel-bpe', 50); // 300 steps recorded as the first 50
    expect(result.timeline?.truncated).toBe(true);
    mounted = await mountRail(appWith(result, { stage: 5, step: 0 }), { motion: false });
    const status = mounted.rail.querySelector('[data-testid="scope-status"]');
    expect(status?.textContent).toBe('merge replay limited to the first 50 steps');
    expect(mounted.rail.querySelector('[data-testid="scrubber"]')?.getAttribute('max')).toBe('50');
  });

  it('states the 2,000-byte window of a SentencePiece replay over 2,000 steps', async () => {
    const result = longResult(1000, 'spm-bpe'); // 3,000 steps over 4,000 bytes, one global sequence
    const app = appWith(result, { stage: 5, step: 0 });
    app.focus = { tier: 'char', byte: 2000 };
    mounted = await mountRail(app, { motion: false });
    const status = mounted.rail.querySelector('[data-testid="scope-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toMatch(/^replaying bytes 1,?000–3,?000$/);
    expect(mounted.rail.querySelector('[data-testid="scrubber"]')?.getAttribute('max')).toBe('1500');
  });

  it('moves a scoped replay with a keyboard step past its end, so the scrubber follows the board', async () => {
    const result = longResult(800); // 2,400 steps: one chunk per word, 3 steps each
    const app = appWith(result, { stage: 5, step: 21 });
    app.focus = { tier: 'char', byte: 4 * 6 }; // chunk 7 (steps 19–21)
    mounted = await mountRail(app, { motion: false });
    const status = mounted.rail.querySelector('[data-testid="scope-status"]');
    const scrubber = mounted.rail.querySelector<HTMLInputElement>('[data-testid="scrubber"]');
    expect(status?.textContent).toBe('replaying chunk 7 of 800');
    expect(scrubber?.value).toBe('3');
    app.moveStep(1); // step 22: the first merge of chunk 8
    flushSync();
    expect(status?.textContent).toBe('replaying chunk 8 of 800');
    expect(scrubber?.value).toBe('1');
    expect(scrubber?.getAttribute('aria-valuetext')).toMatch(/^step 22 \/ 2400 · /);
  });

  it('keeps aria-valuetext fixed while playing (a focused slider speaks every value change)', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 5, step: 2 });
    mounted = await mountRail(app, { motion: false });
    const scrubber = mounted.rail.querySelector<HTMLInputElement>('[data-testid="scrubber"]');
    scrubber?.focus();
    await userEvent.keyboard(' ');
    expect(app.playing).toBe(true);
    flushSync();
    expect(scrubber?.getAttribute('aria-valuetext')).toBe('playing the merges');
    app.step = 4; // a played step
    flushSync();
    expect(scrubber?.getAttribute('aria-valuetext')).toBe('playing the merges');
    await userEvent.keyboard(' ');
    flushSync();
    expect(app.playing).toBe(false);
    expect(scrubber?.getAttribute('aria-valuetext')).toMatch(new RegExp(`^step ${String(app.step)} / \\d+ · `));
  });

  it('keeps the step while no result matches the text, and clamps it once one does', async () => {
    const result = fixtureResult('openai-o200k_base', 'zh-tw-tainan');
    const app = appWith(result, { stage: 5, step: 5 });
    mounted = await mountRail(app, { motion: false });
    app.text = `${app.text}!`; // typing: the result no longer matches, stepCount reads 0
    flushSync();
    expect(app.currentResult).toBeNull();
    expect(app).toMatchObject({ stage: 5, step: 5 });
    app.text = result.input.text;
    app.stage = 6;
    flushSync();
    expect(app.step).toBe(app.stepCount);
  });
});

describe('follow mode and the merge list never fight a manual scroll (05 §2)', () => {
  /** Makes the page scrollable well past the rail and board. */
  function tallPage(): HTMLElement {
    const spacer = document.createElement('div');
    spacer.style.height = '6000px';
    document.body.append(spacer);
    return spacer;
  }

  async function openMergeList(rail: HTMLElement): Promise<HTMLOListElement> {
    rail.querySelector<HTMLButtonElement>('[data-testid="merges-toggle"]')?.click();
    for (let i = 0; i < 200 && rail.querySelector('[data-testid="merge-list"]') === null; i++) await frames(1);
    const list = rail.querySelector<HTMLOListElement>('[data-testid="merge-list"]');
    if (list === null) throw new Error('merge list not rendered');
    return list;
  }

  it('turns off on the page scrolling keys and a scrollbar press, and Play does not turn it back on', async () => {
    const app = appWith(fixtureResult('openai-o200k_base', 'zh-tw-tainan'), { stage: 5, step: 1 });
    mounted = await mountRail(app, { motion: false });
    const scrolls: unknown[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation((options) => {
      scrolls.push(options);
    });
    const step = (k: number): void => {
      app.step = k;
      flushSync();
    };
    step(2);
    expect(scrolls).toHaveLength(1); // follow mode
    mounted.rail
      .querySelector('[data-testid="scrubber"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); // the scrubber's own key
    step(3);
    expect(scrolls).toHaveLength(2);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    step(4);
    expect(scrolls).toHaveLength(2); // the page scrolled by keyboard: off
    const play = mounted.rail.querySelector<HTMLButtonElement>('[data-testid="play"]');
    play?.click(); // Play keeps the reader's place
    flushSync();
    expect(app.playing).toBe(true);
    step(5);
    expect(scrolls).toHaveLength(2);
    play?.click();
    const scrubber = mounted.rail.querySelector<HTMLInputElement>('[data-testid="scrubber"]');
    scrubber?.focus();
    await userEvent.keyboard('{End}'); // jump to end: on again
    await frames(1);
    expect(scrolls).toHaveLength(3);
    const root = document.documentElement;
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: root.clientWidth + 2, clientY: 10 })); // a press on the page's scrollbar
    app.stage = 5;
    step(2);
    expect(scrolls).toHaveLength(3);
  });

  it('scrolls the merge list itself, never the page, and gives the list one tab stop with arrow keys', async () => {
    const app = appWith(longResult(100), { stage: 5, step: 1 }); // 300 steps, one scope
    mounted = await mountRail(app, { motion: false });
    const spacer = tallPage();
    try {
      const list = await openMergeList(mounted.rail);
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      window.scrollTo(0, 1500);
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })); // a manual scroll
      for (let k = 2; k <= 60; k += 4) {
        app.step = k;
        flushSync();
        await frames(2);
        expect(window.scrollY).toBe(1500);
      }
      expect(scrollIntoView).not.toHaveBeenCalled();
      const current = list.querySelector('[aria-current="step"]');
      expect(current?.textContent).toMatch(/^step 58 \/ 300 · /);
      const inside = (): boolean => {
        const box = list.getBoundingClientRect();
        const row = current?.getBoundingClientRect();
        return row !== undefined && row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
      };
      await expect.poll(inside, { timeout: 2000 }).toBe(true); // smooth, inside the list
      expect(list.scrollTop).toBeGreaterThan(0);
      expect(window.scrollY).toBe(1500);

      const tabbable = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('button[tabindex="0"]')];
      expect(tabbable()).toHaveLength(1); // one tab stop: the current step's row
      expect(tabbable()[0]).toBe(current);
      tabbable()[0]?.focus(); // (focusing it scrolls the page to the list, as Tab would)
      const y = window.scrollY;
      await userEvent.keyboard('{ArrowDown}');
      await frames(1);
      expect(document.activeElement?.textContent).toMatch(/^step 59 \/ 300 · /);
      expect(tabbable()).toEqual([document.activeElement]);
      await userEvent.keyboard('{End}');
      await frames(1);
      expect(document.activeElement?.textContent).toMatch(/^step 300 \/ 300 · /);
      await userEvent.keyboard('{Home}');
      await frames(1);
      expect(document.activeElement?.textContent).toMatch(/^step 1 \/ 300 · /);
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      await frames(1);
      expect(app.step).toBe(3); // Enter scrubs to the focused row
      expect(window.scrollY).toBe(y); // the arrows moved within the list only
    } finally {
      spacer.remove();
      window.scrollTo(0, 0);
    }
  });
});
