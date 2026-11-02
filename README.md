# Score Keeper

A simple Progressive Web App for keeping score in any game, round by round.

**Use it:** https://brian-borup.github.io/score-keeper/

On an iPhone, open that link in Safari, tap **Share → Add to Home Screen**. It then runs full-screen and works offline. Scores are saved only on the device.

## Features

- Add players by typing in the "+ Player" row; rename by typing over a name; swipe a name left to delete that player
- Add as many rounds as you need; each player gets a score per round
- Running total for each player
- Gear menu: choose whether the high or low score wins (the leader gets a 👑), clear scores, or clear all players
- Tap the Player or Total header to sort ascending ▲, again for descending ▼, and a third time to return to the order players were added

## Developing

Plain HTML, CSS and JavaScript — no build step.

```
node serve.js
```

then open http://localhost:8080. When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.
