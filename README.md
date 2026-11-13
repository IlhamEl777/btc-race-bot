# btc-race-bot — dip-buy mean-reversion bot for the make.fun BTC 24h race

Entry for `btc-race-24h-20261113-2314` (pool $250, 10 paid places). Trades
Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, long
only, starting from $1,000 of paper money.

## Strategy

The bot sits in cash most of the time and only buys a dip, then sells the
bounce:

- **Buy** the whole cash balance when the close is **1.4% or more below the
  rolling 90-bar high**, after a 60-bar cooldown since the last exit.
- **Sell** the whole position at **+0.4% over entry**, at **-0.6% under entry**,
  or after **240 bars** held — whichever comes first.
- **Drawdown brake:** if equity falls 8% from its peak, liquidate and stop
  trading for the rest of the window (the race bar is 25%).

Why this shape: the published dev window is a grinding -4.9% down-trend day.
Buy-and-hold loses ~$53 on it and every shipped baseline loses money
(ema-cross -$109, rsi-bollinger -$66, adx-momentum -$50, momentum -$49).
A dip-buy catches the intraday bounces instead of riding the trend down.

Why 60% size: a full-size round trip pays ~26 bps in fees, slippage and
price impact on this thin pool. At 60% size the impact roughly halves while
the edge per trade stays, so the net per trade is better.

## Grades (official `grade-local --driver process` on the dev window)

| version | net PnL | trades | max drawdown | dev gate |
|---------|--------:|-------:|-------------:|----------|
| v4 (full size, L=90, dip 1.4%, tp +0.4%, sl -0.6%, cooldown 60) | -$9.66 | 12 | 1.6% | FAIL |
| v5 (60% size, L=120, dip 1.3%, tp +0.4%, sl -1.2%, cooldown 30) | **+$6.62** | 16 | 0.8% | **PASS** |

Net PnL at 2x fees is still +$2.77, so the edge survives a doubling of
costs. The parameters sit on a broad plateau, not a spike: 167 of 972 nearby
combinations are also positive, and the same configuration is positive on the
time-reversed window (+$0.88), the second half alone (+$2.53), and a
time-shifted copy (+$3.85) — so it is not overfit to one stretch of the day.

Lesson from v4: the first simulator understated price impact by a factor of
1,000,000 (it fed USD where the pool depth is in USDC raw units), which made
full size look like +$17.69. The official grader's action log exposed it:
the real fills were ~13 bps worse than simulated. The simulator was fixed to
work in quote units and now matches the official grade to the cent
(+$6.63 simulated vs +$6.62 official).

## Layout

- `main.ts` — the bot (TypeScript, Node 22 type-stripping, stdlib only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's Python/TS SDK
  shim (excluded from authorship counts per the rules).

## Run locally

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot . --driver process
```
