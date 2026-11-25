// Token launch radar model (radar-2): one snapshot in, one ranked board of pre-token protocols out.
//
// IMPLIED VALUE (this entry's own claim, derived only from the snapshot's own figures):
//
//   implied      = max(1, round(tvl_usd x 0.25 x growthMult x maturityMult x chainMult x categoryMult))
//   growthMult   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5            (change_7d unknown: 0)
//   maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4                (age unknown: 365 days)
//   chainMult    = 1 + 0.04 x min(chains - 1, 5)                         (no chains listed: 1 chain)
//   categoryMult = clamp((category median TVL / all-protocol median TVL) ^ 0.15, 0.85, 1.25)
//                  medians run over every protocol in the snapshot; 1.0 for a category of fewer than 3 protocols
//                  Scope: category medians are computed over ALL protocols in the snapshot, pre-token and live-token
//                  alike, because they measure the size of the sector on DefiLlama, not of the token-less subset.
//
// age_days = whole days from the snapshot's listed_at date to its as_of date. No protocol name is ever
// special-cased: the same function scores every row. The implied value is this entry's own claim. It does
// not predict whether or when a token is issued, and it is never make.fun's claim.
//
// Board: every watchlist slug, then pre-token protocols below the floor by TVL, until 200 rows. Ranked by
// implied value descending, slug ascending on ties. The live-token set (top 24 by market cap) is kept apart.

/** One protocol as the sealed snapshot carries it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every constant of the model, stated on the dashboard's methodology section. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_extra_max: number;
  category_exponent: number;
  category_floor: number;
  category_cap: number;
  category_min_protocols: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_extra_max: 5,
  category_exponent: 0.15,
  category_floor: 0.85,
  category_cap: 1.25,
  category_min_protocols: 3,
};

export const MODEL_VERSION = 'radar-2';
export const BOARD_ROWS = 200;
export const LIVE_ROWS = 24;

export interface CategoryStat {
  n: number;
  median_tvl: number;
  mult: number;
}

/** Category medians computed from the snapshot, plus the all-protocol median they are measured against. */
export interface CategoryTable {
  all_median_tvl: number;
  categories: Record<string, CategoryStat>;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's row: the snapshot figures, the model's output and the farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocol_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  board_tvl_usd: number;
  all_median_tvl: number;
  categories: Record<string, CategoryStat>;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The category median table: every protocol in the snapshot counts, whatever its token status. */
export function categoryTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): CategoryTable {
  const allMedian = median(protocols.map((p) => p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.category === null) continue;
    const g = groups.get(p.category);
    if (g === undefined) groups.set(p.category, [p.tvl_usd]);
    else g.push(p.tvl_usd);
  }
  const categories: Record<string, CategoryStat> = {};
  for (const name of [...groups.keys()].sort(cmp)) {
    const tvls = groups.get(name)!;
    const med = median(tvls);
    categories[name] = { n: tvls.length, median_tvl: med, mult: categoryMultOf(tvls.length, med, allMedian, model) };
  }
  return { all_median_tvl: allMedian, categories };
}

export function categoryMultOf(n: number, medianTvl: number, allMedian: number, model: ModelConstants): number {
  if (n < model.category_min_protocols || allMedian <= 0) return 1;
  return clamp(Math.pow(medianTvl / allMedian, model.category_exponent), model.category_floor, model.category_cap);
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  categoryMult: number;
  age: number | null;
}

/** The one scoring function: every row, watchlist or early, goes through it. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, table: CategoryTable): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(p.chains.length - 1, 0), model.chain_extra_max);
  const categoryMult = p.category === null ? 1 : (table.categories[p.category]?.mult ?? 1);
  const implied = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * growthMult * maturityMult * chainMult * categoryMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, categoryMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may add a protocol below the floor: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: action, then cost and time; always 20 to 600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page.`;
  return s;
}

/** Roughly what one transaction costs on a chain, in whole dollars to quote. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'ton' || c === 'tron') return 0.1;
  if (['base', 'arbitrum', 'optimism', 'op mainnet', 'linea', 'scroll', 'zksync era', 'blast', 'mantle', 'polygon', 'bsc', 'binance', 'avalanche', 'gnosis', 'sonic', 'berachain', 'unichain', 'ink', 'hyperliquid l1'].includes(c)) return 0.4;
  return 1;
}

const money = (n: number): string => (n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`);

/** Capital by TVL tier: a bigger pool takes a bigger position before the position moves the pool. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 250_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  if (tvl >= 15_000_000) return 50;
  return 25;
}

/** Hold period by age: the younger the protocol, the longer a record needs to run to show in a snapshot. */
function holdFor(age: number | null): { days: number; why: string } {
  if (age === null) return { days: 45, why: 'its listing date is unknown, so assume it is new' };
  if (age < 90) return { days: 75, why: `it was listed only ${age} days ago, so its rules may still change` };
  if (age < 180) return { days: 60, why: `it is under six months old (${age} days)` };
  if (age < 365) return { days: 45, why: `it is under a year old (${age} days)` };
  if (age < 730) return { days: 30, why: `it has run ${Math.round(age / 30)} months` };
  return { days: 21, why: `it has run ${(age / 365).toFixed(1)} years and its rules are settled` };
}

interface Kind {
  action: (cap: number, chain: string, name: string) => string;
  weekly: string;
}

/** The category's main action and its weekly follow-up, matched on DefiLlama's category name. */
function kindFor(category: string | null): Kind {
  const c = (category ?? '').toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => c.includes(x));
  if (has('prediction')) return { action: (k, ch, n) => `Fund a ${n} account on ${ch} with $${k} of USDC and buy shares in two or three open markets you can explain.`, weekly: 'trade in one new market or add to an open one' };
  if (has('perp', 'derivative', 'option')) return { action: (k, ch, n) => `Deposit $${k} of USDC as margin on ${n} on ${ch}; open one small position at 1x to 2x leverage and close it again.`, weekly: 'open and close one small trade' };
  if (has('lending', 'cdp', 'collateral')) return { action: (k, ch, n) => `Supply $${k} of USDC to ${n} on ${ch}, then borrow about a fifth of it and keep the loan far from liquidation.`, weekly: 'top up, repay a little, or re-borrow once' };
  if (has('curator', 'allocator')) return { action: (k, ch, n) => `Deposit $${k} of USDC into one ${n} vault on ${ch} and keep the vault shares in the same wallet.`, weekly: 'check the vault allocation and add a small top-up' };
  if (has('basis', 'cedefi')) return { action: (k, ch, n) => `Deposit $${k} of the stable asset ${n} accepts on ${ch} into its yield vault and keep the receipt token.`, weekly: 'check the vault rate and add a small top-up' };
  if (has('dex', 'liquidity manager', 'amm')) return { action: (k, ch, n) => `Swap once, then add $${k} of liquidity to ${n}'s deepest stable pair on ${ch} and keep the position open.`, weekly: 'make one swap and collect fees' };
  if (has('yield', 'farm')) return { action: (k, ch, n) => `Deposit $${k} into one ${n} vault on ${ch} that pays in the vault's own asset, not a leveraged one.`, weekly: 'compound or harvest once' };
  if (has('rwa')) return { action: (k, ch, n) => `Check ${n}'s eligibility rules, then mint or buy $${k} of its yield-bearing asset on ${ch} if you qualify.`, weekly: 'hold, check the asset price, and read any notice' };
  if (has('stak', 'restak')) return { action: (k, ch, n) => `Stake $${k} of the asset ${n} supports on ${ch} and keep the receipt token in the wallet.`, weekly: 'check the staking rate and restake any reward' };
  if (has('bridge')) return { action: (k, ch, n) => `Bridge $${k} of USDC to ${ch} through ${n}, use it once in an app there, then bridge back.`, weekly: 'make one bridge trip' };
  if (has('launchpad')) return { action: (k, ch, n) => `Join one open sale on ${n} on ${ch} with $${k} or less, and read its lock-up terms first.`, weekly: 'check the sale page for new rounds' };
  if (has('insurance')) return { action: (k, ch, n) => `Buy $${k} of cover from ${n} on ${ch} against a protocol you already use.`, weekly: 'check the cover is still active' };
  if (has('stable', 'reserve', 'algo')) return { action: (k, ch, n) => `Mint or deposit $${k} of the stable asset through ${n} on ${ch} and keep it in the wallet.`, weekly: 'use the stable asset in one payment or swap' };
  if (has('payment', 'card')) return { action: (k, ch, n) => `Fund a ${n} account on ${ch} with $${k} and make two small payments.`, weekly: 'make one small payment' };
  if (has('index')) return { action: (k, ch, n) => `Buy $${k} of one ${n} index product on ${ch} and keep it.`, weekly: 'check the index weights' };
  if (has('privacy')) return { action: (k, ch, n) => `Shield $${k} of USDC through ${n} on ${ch}, then withdraw to a second fresh address.`, weekly: 'make one private transfer' };
  if (has('chain')) return { action: (k, ch, n) => `Move $${k} of the native asset to ${n} (${ch}) and use two apps on it.`, weekly: 'use one app on the chain' };
  return { action: (k, ch, n) => `Deposit $${k} of USDC into ${n} on ${ch} and keep the position open.`, weekly: 'make one qualifying action' };
}

/** Six steps from the protocol's own record: category, chains, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const cap = capitalFor(p.tvl_usd);
  const gas = gasPerTx(chain);
  const hold = holdFor(age);
  const kind = kindFor(p.category);
  const more = p.chains.length - 1;
  const tvlText = p.tvl_usd >= 1e9 ? `$${(p.tvl_usd / 1e9).toFixed(1)}B` : `$${Math.round(p.tvl_usd / 1e6)}M`;
  const tier = `${p.name} holds about ${tvlText} of TVL`;
  const unwind = gas * 3;
  const steps: string[] = [];
  steps.push(stepText(
    `Create a fresh wallet for ${p.name} and keep its seed phrase offline. Send it ${money(cap + gas * 6)} on ${chain}: $${cap} to farm and the rest for gas.`,
    `about ${money(gas * 2)} to move the funds in`,
    '10 minutes',
  ));
  steps.push(stepText(kind.action(cap, chain, p.name), `$${cap} of capital and about ${money(gas * 3)} of gas`, '15 to 20 minutes'));
  steps.push(stepText(
    `Each week, ${kind.weekly}, so the wallet shows steady use and not one burst. ${tier}, so a $${cap} position is small beside the pool.`,
    `about ${money(gas * 2)} of gas a week`,
    '10 minutes a week',
  ));
  steps.push(stepText(
    `Hold the position for at least ${hold.days} days: ${hold.why}. Do not rotate it into another protocol meanwhile.`,
    `the $${cap} stays locked in the position`,
    `${hold.days} days`,
  ));
  steps.push(stepText(
    more > 0
      ? `${p.name} is on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${more > 2 ? ', ...' : ''}). Repeat one small action on a second chain with $${Math.max(10, Math.round(cap / 5))}; keep a log of dates and transaction links.`
      : `${p.name} is listed on ${chain} only. Keep a log of dates and transaction links; there is no second chain to spread across.`,
    `about ${money(gas * 2)} of gas`,
    '15 minutes plus the log',
  ));
  steps.push(stepText(
    `Claim only from ${p.name}'s own published page, and never pay anyone to claim. The implied value on this board is this entry's own claim; it does not predict whether or when a token is issued.`,
    `free to check; budget ${money(unwind)} of gas to unwind`,
    '15 minutes',
  ));
  return steps;
}

// ---------------------------------------------------------------- the board

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; table: CategoryTable } {
  validateWatchlist(snapshot.protocols, snapshot.watchlist, snapshot.floor_usd);
  const table = categoryTable(snapshot.protocols, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || cmp(a.slug, b.slug));
  for (const p of early) {
    if (chosen.size >= Math.max(BOARD_ROWS, snapshot.watchlist.length)) break;
    chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model, table) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || cmp(a.p.slug, b.p.slug));
  const board = scored.map(({ p, s }, i): BoardRow => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.categoryMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age),
  }));
  return { board, table };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || cmp(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, table } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows = board.map((r): RadarRow => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    watchlist: watch.has(r.slug),
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    chain_multiplier: r.model.chain_multiplier,
    category_multiplier: r.model.category_multiplier,
    farm_steps: r.farm_steps,
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    board_tvl_usd: board.reduce((a, r) => a + r.tvl_usd, 0),
    all_median_tvl: table.all_median_tvl,
    categories: table.categories,
    rows,
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- parsing and checks

/** A YYYY-MM-DD string that is a real calendar date (round-trips through UTC, so 2026-02-30 fails). */
function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A present optional numeric: explicit null stays null; a non-finite value is rejected. */
function optNum(v: unknown, field: string, slug: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError(`protocol ${slug} has non-finite ${field}: ${String(v)}`);
  return v;
}

/** Every watchlist slug must be pre-token and at or above the floor. Call before building either table. */
function validateWatchlist(protocols: SnapshotProtocol[], watchlist: string[], floorUsd: number): void {
  const index = new Map(protocols.map((p) => [p.slug, p]));
  for (const slug of watchlist) {
    const p = index.get(slug);
    if (p === undefined) continue;
    if (!isPreToken(p)) {
      const field = p.mcap_usd !== null ? 'mcap_usd' : p.gecko_id !== null ? 'gecko_id' : 'symbol';
      throw new SnapshotError(`watchlist slug ${slug} is not pre-token (${field} is set)`);
    }
    if (p.tvl_usd < floorUsd) throw new SnapshotError(`watchlist slug ${slug} is below the floor (tvl_usd ${p.tvl_usd} < ${floorUsd})`);
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !isRealDate(o.as_of)) throw new SnapshotError(`snapshot.json has invalid as_of date: ${String(o.as_of)}`);
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
      throw new SnapshotError(`protocol ${i} lacks a slug or a name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${p.slug} has non-finite tvl_usd: ${String(p.tvl_usd)}`);
    }
    if (p.tvl_usd < 0) throw new SnapshotError(`protocol ${p.slug} has negative tvl_usd: ${p.tvl_usd}`);
    if (seen.has(p.slug)) throw new SnapshotError(`duplicate protocol slug ${p.slug}`);
    seen.add(p.slug);
    const change_7d = optNum(p.change_7d, 'change_7d', p.slug);
    const mcap_usd = optNum(p.mcap_usd, 'mcap_usd', p.slug);
    // NOTE (Round 3): a blanket "reject negative mcap_usd" was NOT applied here.
    // The sealed snapshot itself carries mcap_usd -1 for autofinance (a token
    // protocol, gecko_id tokemak), so rejecting any negative mcap would refuse
    // the sealed snapshot and break the run. Only non-finite mcap values are
    // rejected above; the negative-mcap rule needs a decision on that -1 first.
    let listed_at: string | null = null;
    if (p.listed_at !== null && p.listed_at !== undefined) {
      if (typeof p.listed_at !== 'string' || !isRealDate(p.listed_at)) {
        throw new SnapshotError(`protocol ${p.slug} has invalid listed_at date: ${String(p.listed_at)}`);
      }
      listed_at = p.listed_at;
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d,
      mcap_usd,
      listed_at,
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  validateWatchlist(protocols, o.watchlist as string[], o.floor_usd);
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length !== BOARD_ROWS) return `the board has ${board.length} rows, not ${BOARD_ROWS}`;
  board.forEach((r, i) => {
    if (r.rank !== i + 1) throw new SnapshotError(`rank ${i + 1} is ${r.rank}`);
  });
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length !== 6) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
