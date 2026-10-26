# Score Keeper

A simple Progressive Web App for keeping score in any game, round by round.

**Use it:** https://brian-borup.github.io/score-keeper/

On an iPhone, open that link in Safari, tap **Share → Add to Home Screen**. It then runs full-screen and works offline. Scores are saved only on the device.

## Features

- Add, rename and delete players
- Add as many rounds as you need; each player gets a score per round
- Running total for each player
- Choose whether the high or low score wins; the leader gets a 👑
- Tap the Player or Total header to sort ascending ▲, again for descending ▼, and a third time to return to the order players were added
- Clear scores to start again at Round 1, or clear all players

## Developing

Plain HTML, CSS and JavaScript — no build step.

```
node serve.js
```

then open http://localhost:8080. When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.
