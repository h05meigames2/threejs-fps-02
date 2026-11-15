# __REPO__

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/__OWNER__/__REPO__/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/__OWNER__/__REPO__/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**RUSTLINE** is an original round-based tactical FPS for the browser, built on three.js 0.187.0 with no build step and no network requests. You hold a dusk scrapyard — Ember Yard — for the Wardens against the Breakers, a four-bot raiding team carrying a bomb. Rounds are won by eliminating the other side, stopping the plant, or defusing the device (hold E); the Breakers win by detonating it or wiping your team. First to 7 rounds takes the match.

Between rounds a buy phase turns earnings (kill, win and loss bonuses) into five guns — the P9 sidearm, Wasp SMG, Scattergun, VK-7 Carbine and Longshot DMR — plus armour and frag/smoke grenades. Gunplay is hitscan with head/leg hit zones, distance falloff, spread that punishes firing on the move, recoil and bloom; stopping, crouching and aiming down sights all tighten the cone. Bots perceive through a view cone, line of sight and gunfire noise, follow a waypoint graph across the yard's three lanes, hold sites, plant and guard the bomb, and fight with bursts, strafes and crouches. The map is fully original: a central warehouse, a catwalk bridge over the mid road, a foundry (site A) and a container depot (site B), with procedural canvas textures and fully synthesised WebAudio sound — no asset files at all.

## Run it

```sh
node serve.ts            # serves game/ at http://localhost:8080 — open it in desktop Chrome and click Deploy
# hand the entry in (what the grader runs):
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=__REFCODE__&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
