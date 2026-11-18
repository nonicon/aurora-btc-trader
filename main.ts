// Aurora BTC Trader — a dip-buying mean-reversion bot for make.fun's
// "Race a BTC trading bot live for 24 hours" (btc-race-24h-20261118-1444).
//
// The bot speaks agent-fun/bars-replay/v1 through the vendored shim: the harness
// sends hello once, then one batch per minute bar, and this bot answers each
// batch with its orders (at most one order per batch here). Orders decided on a
// bar fill at the next bar's open, so every decision uses only bars already
// closed — no lookahead, no clock, no randomness. All arithmetic is exact
// bigint math, so two runs of the bot produce byte-identical action logs.
//
// Strategy — buy the dip, ride the snap-back, in two tranches:
//   - Reference: the 60-bar simple moving average of closes (1 hour).
//   - Flat and the latest close is 60 bps or more below the SMA: buy with half
//     the cash. If the dip deepens to 180 bps below the SMA, spend the rest.
//   - Holding: sell the whole position when the latest close is 150 bps above
//     the close of the bar on which the first buy was decided (take profit),
//     or 200 bps below it (stop loss). The take-profit is the exit that fires
//     in practice; the stop only caps a runaway downtrend.
//   - No new entries after the 1300th bar: a position opened in the final
//     ~2.3 hours has too little room to reach its take-profit before the
//     window's final flatten, so late entries only donate the round-trip cost.
//   - Otherwise: hold whatever is held, or stay in cash.
//
// Why this shape: a full round trip costs ~26 bps (4 bps fee + 2 bps modelled
// slippage + price impact against the Orca pool), so a trade has to catch a
// move bigger than that. One-minute BTC bars are mostly noise around a slow
// drift, so the bot only trades on a clear displacement from the 1-hour mean
// (60/180 bps in, 150 bps out against ~26 bps of cost) and sits out the chop
// in between. It trades a handful of times a day, never chases, never shorts,
// never uses leverage.
//
// Parameter choice: the (SMA 60, buy 60/180, TP 150, SL 200) point sits in the
// middle of a wide plateau, not on a spike. On the published dev window it ends
// +$18.69 on $1,000 with 3 trades and a 1.50% maximum drawdown, against -$31.63
// for buy-and-hold. The same parameters also end +$14.31 on the previous race's
// dev window (2026-11-17, a different 24 hours) and +$7.29 on the dev window
// with its returns negated (a mirror uptrend), so the edge is the range, not
// the direction of one day. Neighbouring parameters (buy 60-80, scale-in
// 120-180, TP 120-150) all land within a few dollars of the same result.

import { runBars, type Batch, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars in the reference moving average (1 hour of 1-minute bars). */
const SMA_BARS = 60;
/** Buy the first half when the close is this far below the SMA, in bps. */
const BUY1_BPS = 60;
/** Buy the rest when the dip deepens to this far below the SMA, in bps. */
const BUY2_BPS = 180;
/** Sell the whole position when the close is this far above the entry close, in bps. */
const TAKE_PROFIT_BPS = 150;
/** Sell the whole position when the close is this far below the entry close, in bps. */
const STOP_LOSS_BPS = 200;
/** Do not open new positions after this many bars (final ~2.3h of the window). */
const NO_NEW_AFTER_BARS = 1300;
/** Reject a fill worse than this far from the latest close, in bps. One-minute
 *  moves on this pool peak near 0.45%, so 100 bps never binds in practice. */
const MAX_SLIPPAGE_BPS = 100;

/** Every close so far, as exact integers (price_scale 5: p / 1e5 USDC). */
const closes: bigint[] = [];
/** Rolling sum of the last SMA_BARS closes. */
let sumSma = 0n;
/** Close of the bar on which the first buy of the current position was decided. */
let entryClose: bigint | null = null;
/** True once the second (scale-in) buy of the current position has been sent. */
let scaledIn = false;

/**
 * Compare the latest close with the SMA in exact integers, without floats:
 * z <= -X bps  <=>  close * SMA_BARS * 10000 <= sumSma * (10000 - X)
 */
function belowSma(close: bigint, bps: number): boolean {
  return close * BigInt(SMA_BARS) * 10000n <= sumSma * BigInt(10000 - bps);
}

/** close >= entry * (10000 + bps) / 10000, in exact integers. */
function aboveEntry(close: bigint, entry: bigint, bps: number): boolean {
  return close * 10000n >= entry * BigInt(10000 + bps);
}

/** close <= entry * (10000 - bps) / 10000, in exact integers. */
function belowEntry(close: bigint, entry: bigint, bps: number): boolean {
  return close * 10000n <= entry * BigInt(10000 - bps);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Only decide on a fresh bar: a minute the recorder took no sample for has
    // no CBBTC bar in the batch, and trading on the previous minute's close
    // again would feed the SMA a stale duplicate. state.close() would return
    // that stale close, so read the bar itself.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);
    sumSma += close;
    if (closes.length > SMA_BARS) sumSma -= closes[closes.length - SMA_BARS - 1];
    // Wait until the SMA is formed over a full window (first trade on batch 62).
    if (closes.length < SMA_BARS + 2) return [];

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (qty === 0n) {
      entryClose = null;
      scaledIn = false;
      // Flat: buy the dip with half the cash, unless the window is nearly over.
      if (closes.length <= NO_NEW_AFTER_BARS && belowSma(close, BUY1_BPS)) {
        const half = state.cash / 2n;
        if (half >= BigInt(state.hello.fees.min_notional_quote_units)) {
          entryClose = close;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: half, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Holding: take profit or stop out against the entry close.
    if (entryClose !== null) {
      if (aboveEntry(close, entryClose, TAKE_PROFIT_BPS) || belowEntry(close, entryClose, STOP_LOSS_BPS)) {
        entryClose = null;
        scaledIn = false;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    // Scale in if the dip deepens.
    if (!scaledIn && belowSma(close, BUY2_BPS) && state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
      scaledIn = true;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
