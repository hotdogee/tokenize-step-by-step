/**
 * Focus visible at every Tab stop (WCAG 2.4.7; 05 §8): with the live-check drawer open, Tab from the textarea through the
 * options row, the pipeline rail, the board, the inspector and the drawer to the last stop of the page, then Shift+Tab
 * back to the textarea. At each stop the focused element, one of its direct children (a board cell draws its ring
 * on `.bd-vis`) or its enclosing label / rail stop (an opacity-0 radio rings its `.stop` through `:focus-within`) must
 * draw a computed box-shadow or outline that goes away when focus moves on; an element with opacity 0 does not count.
 * The scrubber rings its thumb pseudo-element, which `getComputedStyle` cannot read, so its own box is compared as pixels
 * instead. This is the check that catches WebKit dropping `box-shadow` on natively themed selects, checkboxes and radios
 * (base.css draws an outline ring on those).
 */
import { expect, test, type ElementHandle, type Page } from '@playwright/test';
import { openDrawer } from './byok-helpers.ts';
import { openShell } from './shell-helpers.ts';

/** More presses than the page has Tab stops (about 35 after the textarea with the drawer open). */
const MAX_PRESSES = 150;

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
function readStop(element: HTMLElement): { name: string; rings: string[]; range: boolean } {
  const regions: ReadonlyArray<readonly [string, string]> = [
    ['board', 'board-grid'],
    ['inspector', 'inspector-host'],
    ['rail', 'pipeline'],
    ['drawer', 'live-check'],
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
    const shadow = style.boxShadow === 'none' ? '' : style.boxShadow;
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
async function missingRing(page: Page, stop: Stop): Promise<string | null> {
  if (stop.pixels !== null) {
    const after = await pixelsOf(page, stop.handle);
    return after?.equals(stop.pixels) === true ? `${stop.name}: looks the same focused and unfocused` : null;
  }
  const after = await stop.handle.evaluate(readStop);
  const shown = stop.rings.some((ring, i) => ring !== '' && ring !== after.rings[i]);
  return shown ? null : `${stop.name}: no ring (${JSON.stringify(stop.rings)})`;
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
async function walk(page: Page, key: 'Tab' | 'Shift+Tab', from: Stop | null): Promise<Leg> {
  const names: string[] = [];
  const failures: string[] = [];
  let previous = from;
  for (let press = 0; press < MAX_PRESSES; press += 1) {
    await page.keyboard.press(key);
    const element = (
      await page.evaluateHandle(() => document.activeElement)
    ).asElement() as ElementHandle<HTMLElement> | null;
    const end =
      element === null ||
      (await element.evaluate(
        (node, last) => node === document.body || node === last || !document.hasFocus(),
        previous?.handle ?? null,
      ));
    if (element === null || end) return { names, failures, last: previous };
    if (previous !== null) {
      const failure = await missingRing(page, previous);
      if (failure !== null) failures.push(failure);
    }
    if (await element.evaluate((node) => node.id === 'text-input')) return { names, failures, last: null };
    const read = await element.evaluate(readStop);
    names.push(read.name);
    previous = {
      name: read.name,
      handle: element,
      rings: read.rings,
      pixels: read.range ? await pixelsOf(page, element) : null,
    };
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
  /^inspector /,
  /^drawer input\[type=radio\]\[data-testid=auth-bearer\]/,
  /^drawer select\[data-testid=anthropic-model\]/,
  /^drawer select\[data-testid=xai-model\]/,
];

test('every Tab stop from the textarea through the rail, board, inspector and drawer shows focus, both ways', async ({
  page,
}) => {
  await openShell(page, 'en');
  await openDrawer(page);
  await page.locator('#text-input').focus();
  await expect(page.locator('#board [data-inspector]')).toHaveAttribute('data-inspector', 'ready');

  const forward = await walk(page, 'Tab', null);
  expect(forward.last, 'Tab ends on the last stop of the page').not.toBeNull();
  if (forward.last === null) return;
  // Back from the last stop (focused again by script; its ring was read when Tab reached it) to the textarea.
  await forward.last.handle.focus();
  const back = await walk(page, 'Shift+Tab', forward.last);
  expect(back.last, 'Shift+Tab ends on the textarea').toBeNull();
  for (const [key, leg] of [
    ['Tab', forward],
    ['Shift+Tab', back],
  ] as const) {
    for (const pattern of MUST_VISIT) {
      expect(leg.names, `${key} reaches ${String(pattern)}`).toContainEqual(expect.stringMatching(pattern));
    }
  }
  expect([...forward.failures, ...back.failures], 'stops without a visible focus indicator').toEqual([]);
});
