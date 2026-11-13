// Dip-buy mean-reversion bot for the make.fun BTC 24h race (cbBTC, 1-minute bars).
//
// Idea: the market is long-only and cash earns nothing, so the bot is in cash most
// of the time and only buys a dip, then sells the bounce. On the published dev
// window (a -4.9% down-trend day) buy-and-hold loses ~$53 and every shipped
// baseline loses money; this bot makes +$17.69 with 12 trades and 0.5% max
// drawdown (official grade-local, see README).
//
// Rules (all constants tuned on the dev window, then checked for robustness on
// the reversed window, the second half, and a time-shifted copy — all positive):
//   - Buy when the close is 1.4% or more below the rolling 90-bar high, with
//     the whole cash balance, after a 60-bar cooldown since the last exit.
//   - Sell the whole position when it is +0.4% over entry, or -0.6% under entry,
//     or after 240 bars held. No trailing stop: the bounces in this market are
//     short and a fixed take-profit banks them before the grind resumes.
//   - At most one open position (the caps allow exactly that); never more than
//     one order per reply.
//   - A global drawdown brake: if equity falls 8% from its peak, stop trading
//     for the rest of the window (never triggered on dev: max drawdown 0.5%).
//     The race bar is 25% max drawdown, so this is a wide safety margin.
//   - max_slippage_bps 300: the largest 1-minute move in the dev window is
//     0.66%, so a fill at the next open is never rejected on slippage.
// Deterministic: every decision is a pure function of the closes seen so far;
// no clock, no environment, no randomness.

import { BPS, runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK_BARS = 90; // rolling-high window
const DIP_BPS = 140; // buy at 1.4% below the rolling high
const TAKE_PROFIT_BPS = 40; // sell at +0.4% over entry
const STOP_LOSS_BPS = 60; // sell at -0.6% under entry
const MAX_HOLD_BARS = 240; // sell after 240 minutes held, whatever the price
const COOLDOWN_BARS = 60; // bars to wait after an exit before the next entry
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
  const close = Number(closeRaw) / 10 ** state.hello.symbols[0].price_scale;
  closes.push(close);

  const equity = state.equity;
  if (equity > peakEquity) peakEquity = equity;
  if (peakEquity > 0 && ((peakEquity - equity) * BPS) / peakEquity >= DRAWDOWN_BRAKE_BPS) {
    halted = true;
  }
  if (halted) {
    // Liquidate once if still holding, then stay out.
    const held = state.positions.get(SYMBOL);
    if (held) return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    return [];
  }

  const held = state.positions.get(SYMBOL);
  if (held) {
    const entry = entryPrice!;
    const retBps = ((close - entry) * BPS) / entry;
    if (retBps >= TAKE_PROFIT_BPS || retBps <= -STOP_LOSS_BPS || batch.seq - entrySeq >= MAX_HOLD_BARS) {
      entryPrice = null;
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
  if (close <= (high * (BPS - DIP_BPS)) / BPS) {
    const notional = state.cash;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryPrice = close;
    entrySeq = batch.seq;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
