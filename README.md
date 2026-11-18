# Aurora BTC Trader

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/nonicon/aurora-btc-trader/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/nonicon/aurora-btc-trader/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A dip-buying mean-reversion bot for make.fun's "Race a BTC trading bot live for 24 hours" (btc-race-24h-20261118-1444).

It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain prices, starting with $1,000 of paper money. Strategy: buy the dip below the 1-hour moving average in two tranches (60 bps, then 180 bps), sell the whole position at +150 bps over the entry close (take profit) or −200 bps (stop loss), and stop opening new positions in the final ~2.3 hours of the window.

- Entry point: `main.ts` (Node 22, standard library only; the `vendor/` shim is the kit's own `makefun-bars.ts`).
- Deterministic: exact bigint arithmetic, no network, no wall clock — two runs on the same data produce identical orders.
- Dev window result (grade-local): **+$18.69 net PnL** on $1,000, 3 trades, 1.50% max drawdown (buy-and-hold: −$31.63).

## License

MIT

---

<sub>Entered on [make.fun](https://make.fun/?ref=nj0kv9v2&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
