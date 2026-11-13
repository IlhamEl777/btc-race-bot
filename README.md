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

## Grades (official `grade-local --driver process` on the dev window)

| version | net PnL | trades | max drawdown | dev gate |
|---------|--------:|-------:|-------------:|----------|
| v1 (L=90, dip 1.4%, tp +0.4%, sl -0.6%, hold 240, cooldown 60) | **+$17.69** | 12 | 0.5% | **PASS** |

The parameters sit on a broad plateau, not a spike: 282 of 864 nearby
parameter combinations are also positive on the dev window, and the same
configuration is positive on the time-reversed window (+$3.30), the second
half alone (+$8.45), and a time-shifted copy (+$15.31) — so it is not
overfit to one stretch of the day.

## Layout

- `main.ts` — the bot (TypeScript, Node 22 type-stripping, stdlib only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's Python/TS SDK
  shim (excluded from authorship counts per the rules).

## Run locally

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot . --driver process
```
