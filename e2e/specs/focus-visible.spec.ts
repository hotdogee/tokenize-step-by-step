/**
 * Focus visible at every Tab stop (WCAG 2.4.7; 05 §8): with the Advanced disclosure and the live-check drawer open, Tab
 * from the textarea through the Examples menu button, the comparison table (its chip tab stop and the row selects), the
 * Advanced summary, the picker, the pipeline rail, the board, the inspector, the options and the drawer to the last stop
 * of the page, then Shift+Tab back to the textarea and on through the header to the first stop of the page. At each stop the
 * focused element, one of its direct children (a board cell draws its ring on `.bd-vis`) or its enclosing label / rail
 * stop (an opacity-0 radio rings its `.stop` through `:focus-within`) must draw a computed box-shadow or outline that
 * goes away when focus moves on; an element with opacity 0 does not count.
 * The scrubber rings its thumb pseudo-element, which `getComputedStyle` cannot read, so its own box is compared as pixels
 * instead. This is the check that catches WebKit dropping `box-shadow` on natively themed selects, checkboxes and radios
 * (base.css draws an outline ring on those).
 *
 * The same tour runs again in forced colours (Windows High Contrast, 05 §11), where browsers drop `box-shadow`: there only
 * a computed outline counts (on the element, its `.bd-vis` child or its rail stop), the scrubber's included.
 */
import { expect, test, type ElementHandle, type Page } from '@playwright/test';
import { openDrawer } from './byok-helpers.ts';
import { openShell } from './shell-helpers.ts';

/** More presses than the page has Tab stops (about 45 with the drawer open). */
const MAX_PRESSES = 150;

/** What counts as a ring: a box-shadow or an outline, or (forced colours, where box-shadow is dropped) an outline only. */
type RingKind = 'any' | 'outline';

/** What one Tab stop drew while focused. */
interface Stop {
  /** `region tag[type][data-testid]#id.class`, for failure messages and the coverage check. */
  readonly name: string;
  readonly handle: ElementHandle<HTMLElement>;
  /** Per candidate (the element, its direct children, its label or rail stop): the computed ring, '' when none. */
  readonly rings: readonly string[];
  /** The scrubber's box as pixels while focused (its ring is on the thumb pseudo-element); null elsewhere. */
  readonly pixels: Buffer | null;
}

/** Names the focused element and reads the ring of each candidate element (runs in the page). */
function readStop(element: HTMLElement, kind: RingKind): { name: string; rings: string[]; range: boolean } {
  const regions: ReadonlyArray<readonly [string, string]> = [
    ['board', 'board-grid'],
    ['inspector', 'inspector-host'],
    ['rail', 'pipeline'],
    ['drawer', 'live-check'],
    ['table', 'compare'],
  ];
  const region = regions.find(([, id]) => element.closest(`[data-testid="${id}"]`) !== null)?.[0] ?? 'page';
  const type = element.getAttribute('type');
  const testId = element.dataset['testid'];
  const classes = [...element.classList].filter((name) => !name.startsWith('svelte-'));
  const name = [
    `${region} ${element.tagName.toLowerCase()}`,
    type === null ? '' : `[type=${type}]`,
    testId === undefined ? '' : `[data-testid=${testId}]`,
    element.id === '' ? '' : `#${element.id}`,
    classes.length === 0 ? '' : `.${classes.join('.')}`,
  ].join('');
  const candidates: Element[] = [element, ...element.children];
  const host = element.parentElement?.closest('label, .stop');
  if (host !== null && host !== undefined) candidates.push(host);
  const rings = candidates.map((candidate) => {
    const style = getComputedStyle(candidate);
    if (style.opacity === '0' || style.visibility === 'hidden') return '';
    const shadow = style.boxShadow === 'none' || kind === 'outline' ? '' : style.boxShadow;
    const outline =
      style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) === 0
        ? ''
        : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
    return shadow === '' && outline === '' ? '' : `${shadow} | ${outline}`;
  });
  return { name, rings, range: element instanceof HTMLInputElement && element.type === 'range' };
}

/** The element's own border box as a viewport screenshot (caret hidden, animations finished). */
async function pixelsOf(page: Page, handle: ElementHandle<HTMLElement>): Promise<Buffer | null> {
  const box = await handle.boundingBox();
  if (box === null || box.width < 1 || box.height < 1) return null;
  return page.screenshot({ clip: box, animations: 'disabled' });
}

/** Why a stop showed no focus indicator, comparing what it drew focused with what it draws once focus has moved on. */
async function missingRing(page: Page, stop: Stop, kind: RingKind): Promise<string | null> {
  if (stop.pixels !== null) {
    const after = await pixelsOf(page, stop.handle);
    return after?.equals(stop.pixels) === true ? `${stop.name}: looks the same focused and unfocused` : null;
  }
  const after = await stop.handle.evaluate(readStop, kind);
  const shown = stop.rings.some((ring, i) => ring !== '' && ring !== after.rings[i]);
  return shown ? null : `${stop.name}: no ring (${JSON.stringify(stop.rings)})`;
}

/** The focused element, if any. */
async function focused(page: Page): Promise<ElementHandle<HTMLElement> | null> {
  return (await page.evaluateHandle(() => document.activeElement)).asElement() as ElementHandle<HTMLElement> | null;
}

/** Reads the focused `element` as a stop: its candidates' rings, and the scrubber's pixels outside forced colours. */
async function stopOf(page: Page, element: ElementHandle<HTMLElement>, kind: RingKind): Promise<Stop> {
  const read = await element.evaluate(readStop, kind);
  return {
    name: read.name,
    handle: element,
    rings: read.rings,
    // In forced colours the scrubber's own box carries the outline, which getComputedStyle reads.
    pixels: read.range && kind === 'any' ? await pixelsOf(page, element) : null,
  };
}

/** One leg of the tour: the stops in order, the stops without a visible focus indicator, and the stop it ended on. */
interface Leg {
  readonly names: string[];
  readonly failures: string[];
  readonly last: Stop | null;
}

/**
 * Presses `key` until focus reaches the textarea or can go no further, checking each stop once focus has moved to the
 * next one. Past the last stop focus goes to the body or the browser UI (chromium, WebKit) or stays put (Firefox), so
 * that stop is returned unchecked as `last`; the way back starts from it.
 */
async function walk(page: Page, key: 'Tab' | 'Shift+Tab', from: Stop | null, kind: RingKind): Promise<Leg> {
  const names: string[] = [];
  const failures: string[] = [];
  let previous = from;
  for (let press = 0; press < MAX_PRESSES; press += 1) {
    await page.keyboard.press(key);
    const element = await focused(page);
    const end =
      element === null ||
      (await element.evaluate(
        (node, last) => node === document.body || node === last || !document.hasFocus(),
        previous?.handle ?? null,
      ));
    if (element === null || end) return { names, failures, last: previous };
    if (previous !== null) {
      const failure = await missingRing(page, previous, kind);
      if (failure !== null) failures.push(failure);
    }
    if (await element.evaluate((node) => node.id === 'text-input')) return { names, failures, last: null };
    previous = await stopOf(page, element, kind);
    names.push(previous.name);
  }
  failures.push(`focus was still moving after ${String(MAX_PRESSES)} presses`);
  return { names, failures, last: previous };
}

/** Stops each leg must reach: the rail's and the drawer's native controls and the scrubber, a board cell, the inspector. */
const MUST_VISIT = [
  /^rail select\[data-testid=speed\]/,
  /^rail input\[type=checkbox\]\[data-testid=reduce-motion\]/,
  /^rail input\[type=range\]\[data-testid=scrubber\]/,
  /^board /,
  /^table div.*\.cmp-chip/,
  /^table select/,
  /^page summary\[data-testid=advanced-summary\]/,
  /^page button.*\[data-testid=picker-button\]/,
  /^page button.*\[data-testid=examples-button\]/,
  /^inspector /,
  /^drawer input\[type=radio\]\[data-testid=auth-bearer\]/,
  /^drawer select\[data-testid=anthropic-model\]/,
  /^drawer select\[data-testid=xai-model\]/,
];

/**
 * Tabs from the textarea to the last stop, Shift+Tabs back to the textarea and on to the first stop of the page, then
 * checks coverage and that every stop showed focus.
 */
async function tour(page: Page, kind: RingKind): Promise<void> {
  await openDrawer(page);
  await page.locator('#text-input').focus();
  await expect(page.locator('#board [data-inspector]')).toHaveAttribute('data-inspector', 'ready');

  const forward = await walk(page, 'Tab', null, kind);
  expect(forward.last, 'Tab ends on the last stop of the page').not.toBeNull();
  if (forward.last === null) return;
  // Back from the last stop (focused again by script; its ring was read when Tab reached it) to the textarea.
  await forward.last.handle.focus();
  const back = await walk(page, 'Shift+Tab', forward.last, kind);
  expect(back.last, 'Shift+Tab ends on the textarea').toBeNull();
  // The textarea and the stops before it: Shift+Tab to the first stop of the page, checked by moving on with Tab.
  const textarea = await focused(page);
  expect(textarea, 'the way back leaves focus on the textarea').not.toBeNull();
  if (textarea === null) return;
  const head = await walk(page, 'Shift+Tab', await stopOf(page, textarea, kind), kind);
  expect(head.names, 'Shift+Tab reaches the skip link').toContainEqual(expect.stringMatching(/^page a\.skip-link/));
  const failures = [...forward.failures, ...back.failures, ...head.failures];
  if (head.last !== null) {
    await head.last.handle.focus();
    await page.keyboard.press('Tab');
    const failure = await missingRing(page, head.last, kind);
    if (failure !== null) failures.push(failure);
  }
  for (const [key, leg] of [
    ['Tab', forward],
    ['Shift+Tab', back],
  ] as const) {
    for (const pattern of MUST_VISIT) {
      expect(leg.names, `${key} reaches ${String(pattern)}`).toContainEqual(expect.stringMatching(pattern));
    }
  }
  expect(failures, 'stops without a visible focus indicator').toEqual([]);
}

test('every Tab stop from the header through the rail, board, inspector and drawer shows focus, both ways', async ({
  page,
}) => {
  await openShell(page, 'en', { advanced: true });
  await tour(page, 'any');
});

test('in forced colours every Tab stop draws an outline (box-shadow is dropped there), both ways', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openShell(page, 'en', { advanced: true });
  const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
  test.skip(!forced, 'this browser does not emulate forced colours');
  await tour(page, 'outline');
});
