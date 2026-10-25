/**
 * fast-check runs per property: 1,000 per PR, 20,000 nightly (06 §1). `nightly-fuzz.yml` sets `FAST_CHECK_NUM_RUNS=20000`
 * and runs the core project with a long `--test-timeout`; `TSBS_FC_RUNS` is the older local alias.
 */
export const RUNS = Number(process.env['FAST_CHECK_NUM_RUNS'] ?? process.env['TSBS_FC_RUNS'] ?? 1000);
