/** fast-check runs per property: 1,000 per PR (06 §1); the nightly job raises it with `TSBS_FC_RUNS=20000`. */
export const RUNS = Number(process.env['TSBS_FC_RUNS'] ?? 1000);
