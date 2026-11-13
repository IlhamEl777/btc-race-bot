// Dip-buy mean-reversion bot for the make.fun BTC 24h race (cbBTC, 1-minute bars).
//
// Idea: the market is long-only and cash earns nothing, so the bot is in cash most
// of the time and only buys a dip, then sells the bounce. On the published dev
// window (a -4.9% down-trend day) buy-and-hold loses ~$53 and every shipped
// baseline loses money; this bot makes money with a small, robust edge (see
// README for the official grade-local numbers).
//
// Why half-size: a full-size round trip pays ~26 bps in fees, slippage and
// price impact on this thin pool (a $1,000 buy moves its own price ~10 bps).
// At 60% size the impact roughly halves while the edge per trade stays, so
// the net per trade is better — the simulator (exact fill model, verified
// against the official grader's action log) confirms 0.6 size beats 1.0.
//
// Rules (constants tuned on the dev window, then checked for robustness on
// the reversed window, the second half, and a time-shifted copy — all positive):
//   - Buy 60% of cash when the close is 1.3% or more below the rolling
//     120-bar high, after a 30-bar cooldown since the last exit decision.
//   - Sell the whole position when it is +0.4% over entry, or -1.2% under
//     entry, or after 240 bars held. No trailing stop: the bounces in this
//     market are short and a fixed take-profit banks them before the grind
//     resumes.
//   - At most one open position (the caps allow exactly that); never more than
//     one order per reply.
//   - A global drawdown brake: if equity falls 8% from its peak, stop trading
//     for the rest of the window (never triggered on dev: max drawdown 0.8%).
//     The race bar is 25% max drawdown, so this is a wide safety margin.
//   - max_slippage_bps 300: the largest 1-minute move in the dev window is
//     0.66%, so a fill at the next open is never rejected on slippage.
// Deterministic: every decision is a pure function of the closes seen so far;
// no clock, no environment, no randomness.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

// NOTE: the SDK's BPS is a bigint; all thresholds here are plain numbers.
const BPS_N = 10_000;

const SYMBOL = 'CBBTC';
const LOOKBACK_BARS = 120; // rolling-high window
const DIP_BPS = 130; // buy at 1.3% below the rolling high
const TAKE_PROFIT_BPS = 40; // sell at +0.4% over entry
const STOP_LOSS_BPS = 120; // sell at -1.2% under entry
const MAX_HOLD_BARS = 240; // sell after 240 minutes held, whatever the price
const COOLDOWN_BARS = 30; // bars to wait after an exit decision before the next entry
const SIZE_NUM = 6; // buy 60% of cash (SIZE_NUM / SIZE_DEN)
const SIZE_DEN = 10;
const DRAWDOWN_BRAKE_BPS = 800; // stop trading if equity is 8% under its peak
const MAX_SLIPPAGE_BPS = 300;

/** Closes seen so far, as floats in USDC (close / 10^price_scale). */
const closes: number[] = [];
let entryPrice: number | null = null;
let entrySeq = -1;
let lastExitSeq = -1_000_000;
let peakEquity = 0;
let halted = false;

function onBatch(state: BarsState, batch: any): OrderInput[] {
  if (state.warming_up) return [];
  const closeRaw = state.close(SYMBOL);
  if (closeRaw === null) return [];
  const close = Number(closeRaw) / 10 ** state.hello.symbols.find((s) => s.symbol === SYMBOL)!.price_scale;
  closes.push(close);

  // state.equity is a bigint in the TS shim; the brake math is float.
  const equity = Number(state.equity);
  if (equity > peakEquity) peakEquity = equity;
  if (peakEquity > 0 && ((peakEquity - equity) * BPS_N) / peakEquity >= DRAWDOWN_BRAKE_BPS) {
    halted = true;
  }

  const held = state.positions.get(SYMBOL);
  // The entry price is cleared only when the account says the position is
  // gone, so a rejected sell never strands us holding without an exit rule.
  // The cooldown, however, runs from the sell DECISION (matching the
  // simulator the parameters were tuned with).
  if (!held && entryPrice !== null) {
    entryPrice = null;
  }
  if (halted) {
    // Liquidate once if still holding, then stay out.
    if (held) return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    return [];
  }

  if (held) {
    const entry = entryPrice!;
    const retBps = ((close - entry) * BPS_N) / entry;
    if (retBps >= TAKE_PROFIT_BPS || retBps <= -STOP_LOSS_BPS || batch.seq - entrySeq >= MAX_HOLD_BARS) {
      lastExitSeq = batch.seq;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  if (batch.seq - lastExitSeq < COOLDOWN_BARS) return [];
  if (closes.length <= LOOKBACK_BARS) return [];
  // Rolling high over the previous LOOKBACK_BARS closes, excluding this one.
  let high = -Infinity;
  for (let i = closes.length - LOOKBACK_BARS - 1; i < closes.length - 1; i++) {
    if (closes[i] > high) high = closes[i];
  }
  if (close <= (high * (BPS_N - DIP_BPS)) / BPS_N) {
    // 60% of cash: a full-size buy pays ~10 bps of price impact per leg on
    // this pool, a 60% buy ~6 bps, and the edge per trade is unchanged.
    const notional = (state.cash * BigInt(SIZE_NUM)) / BigInt(SIZE_DEN);
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryPrice = close;
    entrySeq = batch.seq;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
