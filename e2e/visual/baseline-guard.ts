/**
 * The rule every visual spec follows (06 §1 "Visual"): the baselines are Linux renders (`__screenshots__/<name>-linux.png`)
 * produced by the `visual-baselines` workflow and committed from its artifact (docs/release.md § Visual baselines).
 * Until the first baselines are committed (no `*-linux.png` at all), and on any run off Linux, whose font rendering
 * differs, every test skips with a notice instead of writing a baseline nobody reviewed. Once any baseline exists, a
 * missing one fails: a deleted file, a renamed fixture or theme, or a new viewport must not drop coverage silently.
 * `--update-snapshots` on Linux writes them; `--ignore-snapshots` runs the fixtures anywhere without comparing (a dry run
 * that proves they still reach their state).
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import process from 'node:process';
import { expect, test, type TestInfo } from '@playwright/test';

/** True while no Linux baseline is committed at all (before the first visual-baselines run): the only state that skips. */
function bootstrapping(directory: string): boolean {
  return !existsSync(directory) || !readdirSync(directory).some((file) => file.endsWith('-linux.png'));
}

/** Skips or fails the test as the rule above says, before it opens the page for baseline `name`. */
export function guardBaseline(testInfo: TestInfo, name: string): void {
  if (testInfo.project.ignoreSnapshots) return; // a dry run: the screenshots are taken, never compared
  const baseline = testInfo.snapshotPath(`${name}.png`, { kind: 'screenshot' });
  const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed';
  test.skip(process.platform !== 'linux', 'visual baselines are Linux renders (fonts-noto-cjk); run on Linux');
  test.skip(
    !updating && bootstrapping(dirname(baseline)),
    'no visual baselines committed yet: run the visual-baselines workflow and commit its artifact (docs/release.md)',
  );
  expect(
    updating || existsSync(baseline),
    `${basename(baseline)} is missing while other baselines are committed: refresh them (docs/release.md)`,
  ).toBe(true);
}
