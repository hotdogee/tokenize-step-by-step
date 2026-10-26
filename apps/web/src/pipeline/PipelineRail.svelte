<script lang="ts">
  /**
   * The pipeline rail (05 §1 region 3, §2, §3.5, §8): six stops as native radios in a `role="radiogroup"` (one tab stop;
   * arrows move and select; each named "3 of 6: UTF-8 bytes"), the merge-step scrubber, Play, speed, the in-app
   * reduced-motion switch, the `role="status"` scope line ("replaying chunk 2 of 7", "merge replay limited to the first
   * 50,000 steps") and the merge list (lazy, opened on demand). It drives the board only through the AppState timeline
   * position (`stage`, `step`, `playing`, `speed`); the board renders `partsAt(step)` itself.
   *
   * Decisions recorded here (WP09):
   * - Stop 6 ≡ stop 5 at `step = stepCount` (05 §2), so while the stage is 6 the step follows the result's step count:
   *   `[` from stop 6 shows the last merge at stop 5, and the inspector's "formed at step k" sees every step. A step past
   *   a new result's end is clamped — once that result is there: while no result matches the text (typing, a tokenizer
   *   switch, a lazy example) the step is kept, so a deep link's `s=5.7` (WP13) survives until its result arrives.
   * - The global keys (`[` `]` `,` `.` `1`–`6`, App.svelte) move the position; after a keyboard merge step the status
   *   region says the merge sentence (05 §8: merge steps are announced on manual stepping, never during playback). While
   *   playing, the scrubber's `aria-valuetext` stays "playing the merges" (a focused slider's value changes are spoken).
   * - Above 2,000 steps the replay scope follows the board: a step outside it (`,` `.`, the inspector's "show this
   *   step") moves the scope there (scope.ts `scopeAround`) rather than leaving the scrubber at one end.
   * - The scrubber is shown at every stop (disabled without a timeline; position 0 before stop 5, the end at stop 6),
   *   not only at stop 5 (05 §1): the rail keeps one height across stops, so changing stops shifts nothing (CLS, 06 §3).
   * - Follow mode turns off on a manual scroll of the page — wheel or touch outside the rail, the page's scrolling keys
   *   outside the board, the rail and editable fields, or a drag of the page's scrollbar — and back on only with "jump to
   *   end" (05 §2; Play does not).
   * - The merge list sits in the rail under the scrubber (on narrow viewports it is the collapsible section 05 §1 asks
   *   for) with a single tab stop (roving tabindex), so it adds one Tab stop between Play and the board where 05 §8 has
   *   it after the inspector; WP13 kept it here at every width (docs/dev.md, "How the page is wired").
   * - The motion director (motion/director.svelte.ts) animates every commit; the switch crossfades wrap the byte-view,
   *   tokenizer and locale switches (motion/view-transition.ts). Both load nothing before the first interaction.
   */
  import { onMount } from 'svelte';
  import type { TokenizationResult } from '@tsbs/core';
  import type { Stage } from '../app/app-state.svelte.ts';
  import { appState } from '../app/context.ts';
  import { isOnDemand, TRACED_MAX } from '../app/long-input.ts';
  import { viewOf } from '../board/view-cache.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { directMotion } from '../motion/director.svelte.ts';
  import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
  import { wrapSwitches } from '../motion/view-transition.ts';
  import { isEditableTarget, matchShortcut } from '../shell/shortcuts.ts';
  import type MergeListComponent from './MergeList.svelte';
  import { Playback } from './playback.svelte.ts';
  import PlayButton from './PlayButton.svelte';
  import { scopeAround, scopeTicks, stepAt, type Speed } from './scope.ts';
  import Scrubber from './Scrubber.svelte';
  import { stepText } from './sentence.ts';
  import '../motion/motion.css';

  const app = appState();
  const STOPS: readonly Stage[] = [1, 2, 3, 4, 5, 6];
  const NAMES = {
    1: 'stage.1',
    2: 'stage.2',
    3: 'stage.3',
    4: 'stage.4.chunks',
    5: 'stage.5',
    6: 'stage.6',
  } as const;
  const SPEEDS: readonly Speed[] = [0.5, 1, 2];
  /** The hidden "merged at this step" description the director adds to the merged part's cells. */
  const JUST_MERGED_ID = 'tsbs-just-merged';
  /** Keys that scroll the page when nothing else takes them (follow mode turns off, 05 §2). */
  const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
  /** The first of these anywhere on the page loads the choreography chunk (it is not part of the startup JS). */
  const ENGAGE_EVENTS = ['pointerdown', 'keydown', 'focusin'] as const;

  const result = $derived(app.currentResult);
  const view = $derived(result === null ? null : viewOf(result, resolveTextLang(app.textLang, app.text, i18n.current)));
  const scope = $derived(
    result === null
      ? null
      : scopeAround(result, app.pinned?.byte ?? app.focus?.byte ?? 0, app.stage === 5 ? app.step : null),
  );
  const playback = new Playback(app, () => scope);
  const position = $derived(scope === null ? 0 : playback.position(scope));
  const shown = $derived(scope === null ? 0 : stepAt(scope, position));
  const ticks = $derived(result === null || scope === null ? [] : scopeTicks(result, scope));
  const canReplay = $derived(view !== null && result?.timeline !== null && (scope?.count ?? 0) > 0);
  const valueText = $derived(
    view === null || result?.timeline === null
      ? i18n.t('stage.5.pending')
      : app.playing
        ? i18n.t('scrubber.playing')
        : stepText(view, shown, i18n.t),
  );
  const scopeText = $derived.by(() => {
    if (result === null || scope === null) return '';
    const lines: string[] = [];
    if (scope.kind === 'chunk')
      lines.push(i18n.t('status.replayScope', { index: scope.chunk + 1, count: scope.chunks }));
    if (scope.kind === 'window') lines.push(i18n.t('status.replayWindow', { start: scope.start, end: scope.end }));
    // A long input's run (AD-27, WP13): the cap of its recorded prefix, or no timeline at all above 100,000 code points
    // (both on-demand tiers: a capped text's 200,000 analysed code points are untraced too).
    if (result.timeline?.truncated === true)
      lines.push(i18n.t('status.replayLimited', { n: app.replayLimit ?? result.timeline.stepCount }));
    else if (result.timeline === null && result.options.trace === false && isOnDemand(app.longInput))
      lines.push(i18n.t('status.replayOff', { n: TRACED_MAX }));
    return lines.join(i18n.t('a11y.sep'));
  });

  let mergesOpen = $state(false);
  /** The choreography chunk has arrived (`data-motion="ready"`, which tests wait for). */
  let motionReady = $state(false);
  let MergeList: typeof MergeListComponent | null = $state.raw(null);

  function stageName(stage: Stage): string {
    return stage === 4 && app.entry.family === 'spm-bpe' ? i18n.t('stage.4.symbols') : i18n.t(NAMES[stage]);
  }

  function toggleMerges(): void {
    mergesOpen = !mergesOpen;
    if (MergeList !== null) return;
    import('./MergeList.svelte').then(
      (module) => {
        MergeList = module.default;
      },
      () => {
        mergesOpen = false; // a stale deploy: the shell's reload alert covers it
      },
    );
  }

  function seek(p: number): void {
    if (scope !== null) playback.seek(scope, p, true);
  }

  const director = directMotion(app, {
    grid: () => document.querySelector<HTMLElement>('[data-testid="board-grid"]'),
    view: () => view,
    follow: () => playback.follow,
    describedBy: JUST_MERGED_ID,
  });

  // Stop 6 ≡ stop 5 at the last step; a step past the result's end is clamped (see the decisions above).
  $effect(() => {
    if (app.currentResult === null) return;
    const count = app.stepCount;
    if (app.stage === 6 ? app.step !== count : app.step > count) app.step = count;
  });

  // Playback stops when the position leaves stop 5 or the result changes.
  let playedResult: TokenizationResult | null = null;
  $effect(() => {
    const stage = app.stage;
    const current = result;
    if (app.playing && (stage !== 5 || current !== playedResult)) playback.pause();
    playedResult = current;
  });

  // After a keyboard merge step (App.svelte moves the position and announces the stage), say the merge sentence.
  let keyStep = false;
  $effect(() => {
    const step = app.step;
    const stage = app.stage;
    if (!keyStep) return;
    keyStep = false;
    if (stage === 5 && view !== null && step <= view.stepCount) app.announce(stepText(view, step, i18n.t));
  });

  onMount(() => {
    const engage = (): void => {
      for (const type of ENGAGE_EVENTS) document.removeEventListener(type, engage, true);
      void director.load().then(() => {
        motionReady = director.loaded;
      });
    };
    for (const type of ENGAGE_EVENTS) document.addEventListener(type, engage, { capture: true, passive: true });
    const onKeyCapture = (event: KeyboardEvent): void => {
      const action = matchShortcut(event, {
        enabled: app.singleKeyShortcuts,
        inEditable: isEditableTarget(event.target),
        inDialog: document.querySelector('dialog[open]') !== null,
      });
      keyStep = action?.kind === 'step';
      if (keyStep)
        setTimeout(() => {
          keyStep = false;
        }, 0);
    };
    const manualScroll = (event: Event): void => {
      // A drag on the scrubber (touchmove) or a wheel over the rail is not a manual scroll of the board.
      if (event.target instanceof Element && event.target.closest('[data-testid="pipeline"]') !== null) return;
      playback.follow = false;
    };
    const scrollKey = (event: KeyboardEvent): void => {
      // The page's own scrolling keys; the board, the rail (radios, scrubber, merge list), fields and dialogs use them.
      if (!SCROLL_KEYS.has(event.key) || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="grid"], [data-testid="pipeline"], dialog, select, input, textarea') != null) return;
      if (isEditableTarget(event.target)) return;
      // Space scrolls only when nothing focusable has focus (on a button it presses the button).
      if (event.key === ' ' && target !== null && target !== document.body && target !== document.documentElement)
        return;
      playback.follow = false;
    };
    const scrollbarDrag = (event: PointerEvent): void => {
      // A press on the page's scrollbar lands on the root element, beyond its client box.
      const root = document.documentElement;
      if (event.target === root && (event.clientX >= root.clientWidth || event.clientY >= root.clientHeight))
        playback.follow = false;
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('wheel', manualScroll, { passive: true });
    window.addEventListener('touchmove', manualScroll, { passive: true });
    window.addEventListener('keydown', scrollKey);
    window.addEventListener('pointerdown', scrollbarDrag, true);
    const unwrap = wrapSwitches(
      { app, locale: i18n },
      () => document.getElementById('board'),
      () => motionPrefs.reduced,
    );
    return () => {
      for (const type of ENGAGE_EVENTS) document.removeEventListener(type, engage, true);
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('wheel', manualScroll);
      window.removeEventListener('touchmove', manualScroll);
      window.removeEventListener('keydown', scrollKey);
      window.removeEventListener('pointerdown', scrollbarDrag, true);
      unwrap();
      playback.pause();
    };
  });
</script>

<div class="pipeline" data-testid="pipeline" data-motion={motionReady ? 'ready' : 'idle'}>
  <div class="stops" role="radiogroup" aria-label={i18n.t('a11y.pipeline')}>
    {#each STOPS as stage (stage)}
      <label class="stop" class:current={app.stage === stage}>
        <input
          type="radio"
          name="tsbs-stage"
          value={stage}
          checked={app.stage === stage}
          aria-label={i18n.t('a11y.stop', { n: stage, name: stageName(stage) })}
          onchange={() => {
            app.setStage(stage);
            app.announceStage();
          }}
        />
        <span class="num" aria-hidden="true">{stage}</span>
        <span class="control-label" aria-hidden="true">{stageName(stage)}</span>
      </label>
    {/each}
  </div>

  <div class="controls">
    <Scrubber
      max={scope?.count ?? 0}
      value={position}
      {ticks}
      label={i18n.t('scrubber.label')}
      {valueText}
      counter={i18n.t('step.counter', { step: shown, stepCount: view?.stepCount ?? 0 })}
      disabled={!canReplay}
      onseek={seek}
      ontoggle={() => {
        playback.toggle();
      }}
    />
    <PlayButton
      playing={app.playing}
      label={i18n.t('play.label')}
      disabled={!canReplay}
      ontoggle={() => {
        playback.toggle();
      }}
    />
    <select
      aria-label={i18n.t('speed.label')}
      value={String(app.speed)}
      data-testid="speed"
      onchange={(event) => {
        app.speed = Number(event.currentTarget.value) as Speed;
      }}
    >
      {#each SPEEDS as speed (speed)}<option value={String(speed)}>×{speed}</option>{/each}
    </select>
    <label class="check">
      <input
        type="checkbox"
        role="switch"
        checked={motionPrefs.reduced}
        data-testid="reduce-motion"
        onchange={(event) => {
          motionPrefs.setReduced(event.currentTarget.checked);
        }}
      />
      <span class="control-label">{i18n.t('motion.reduce')}</span>
    </label>
    {#if view !== null && view.stepCount > 0}
      <button
        type="button"
        class="btn btn-quiet"
        aria-expanded={mergesOpen}
        aria-controls="tsbs-merge-list"
        data-testid="merges-toggle"
        onclick={toggleMerges}>{i18n.t('merges.toggle', { n: scope?.count ?? 0 })}</button
      >
    {/if}
  </div>

  <p class="scope prose" role="status" data-testid="scope-status">{scopeText}</p>
  {#if mergesOpen && MergeList !== null && view !== null && scope !== null}
    <MergeList id="tsbs-merge-list" {view} {scope} current={shown} t={i18n.t} onseek={seek} />
  {/if}
  <span id={JUST_MERGED_ID} hidden>{i18n.t('a11y.marker.justMerged')}</span>
</div>

<style>
  .pipeline {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  .stops {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .stop {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    padding: 0.25rem 0.625rem;
    border: var(--border-width) solid transparent;
    border-radius: 999px;
    color: var(--fg-muted);
    cursor: pointer;
  }

  .stop:hover {
    background: var(--surface-2);
  }

  .stop.current {
    border-color: var(--accent);
    color: var(--fg);
    font-weight: 600;
  }

  .stop input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .stop:focus-within {
    box-shadow: var(--focus);
  }

  .num {
    display: inline-grid;
    place-items: center;
    width: 1.375rem;
    height: 1.375rem;
    border: var(--border-width) solid var(--border);
    border-radius: 50%;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  select {
    min-height: 2.5rem;
    padding: 0.25rem 0.5rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    cursor: pointer;
  }

  .check input {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .scope {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  @media (forced-colors: active) {
    .stop.current {
      border-color: Highlight;
    }

    .stop:focus-within {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
</style>
