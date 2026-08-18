# VELVET-USD Trade Setup Monitor

Live monitoring dashboard for the VELVET-USD pre-market trade setups (brief dated 2026-08-18). Fetches live market data, validates setup parameters tick-by-tick, and fires a trigger when a setup is validated. Shows how far each parameter is from its desired setup state.

## Data sources (public, no API key)

- **Primary tick stream:** Gate.io WebSocket `spot.tickers` (VELVET_USDT) — updates on every trade
- **REST fallback / cross-check:** Gate.io spot ticker + MEXC bookTicker, polled every 1–2s
- **Candles (session VWAP, prior-day VWAP, ATR14, volume ratios):** Gate.io spot candlesticks (1m / 1h / 1d), re-fetched every 60s

## Live-computed parameters

- Session open / high / low and session VWAP (anchored from 00:00 UTC, 1m typical-price x volume)
- Prior-day VWAP and prior close (yesterday's 1h candles)
- Session volume vs 20-day average volume ratio
- ATR14 (daily and 1h, simple mean of true ranges)
- Last closed 1h close (used by 1h-close trigger conditions)

## Setups monitored (from the brief)

| Setup | Direction | Trigger | Stop | T1 | T2 |
|---|---|---|---|---|---|
| A | LONG | 1h close AND last price above session VWAP (~0.5275) | 0.4810 | 0.5771 | 0.6055 |
| B | SHORT | Session high touched VWAP and price rejected below it | 0.5775 | 0.4750 | 0.4284 |
| C | SHORT | 1h close AND last price below 0.4812 | 0.5155 | 0.4284 | 0.3900 |
| D | LONG | Price in 0.4284–0.4400 entry zone | 0.4120 | 0.4812 | 0.5275 |

Each setup card shows: current price vs trigger, stop/targets, R:R, a proximity bar (distance to trigger as %), and the invalidation condition.

## Trigger behaviour

When a setup transitions to VALIDATED:
- Full-width flashing banner (direction-coded)
- Sound alert (Web Audio, enabled via the "Enable browser alerts" button)
- Browser notification (if permission granted)
- Timestamped entry in the trigger log

Trigger state is edge-detected (fires once per setup per state change, not continuously).

## Deploy

Static site — deploy to any static host (GitHub Pages used here).

```sh
git init && git add -A && git commit -m "init"
gh repo create velvet-dashboard --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/velvet-dashboard/pages -f "source[branch]=main" -f "source[path]=/"
```

## Disclaimer

Levels and setup parameters originate from the 2026-08-18 pre-market brief (altFINS data); live-computed values are re-derived from exchange feeds and may differ slightly. Monitoring tool for planning purposes only — not financial advice.