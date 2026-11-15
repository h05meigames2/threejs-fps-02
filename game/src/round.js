// The match: a state machine over menu → buy → live → end → (next round | match end).
// It owns the score, the clock, the bomb, role assignment, bot loadouts, the player's
// shopping and every win check. Kills arrive through onKill (called from weapons.js);
// payments follow the PAY table in config.js.

import * as THREE from 'three';
import { TEAM, MATCH, PAY } from './config.js';
import { giveWeapon, startReload, throwGrenade, currentWeapon } from './weapons.js';
import { BUY_ITEMS } from './hud.js';

const GUARD_OFFSETS = [
  new THREE.Vector3(3.5, 0, 2.5), new THREE.Vector3(-3.5, 0, 3.5),
  new THREE.Vector3(2.5, 0, -3.5), new THREE.Vector3(-2.5, 0, -2.5),
];
const HOLD_ROTATION = [[0, 2, 4], [1, 3, 5], [0, 3, 4], [1, 2, 5]];

export class RoundManager {
  constructor(game) {
    this.game = game;
    this.state = 'menu';
    this.score = [0, 0];
    this.round = 0;
    this.timer = 0;
    this.timerText = '0:00';
    this.timerLow = false;
    this.phaseLabel = 'Rustline';
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.beepAt = 0;
    this.winner = -1;
    this.endReason = '';
    // the bomb lives here; bots read it through game.bomb
    game.bomb = {
      state: 'carried', carrier: null, pos: new THREE.Vector3(),
      site: null, fuseLeft: 0, blink: false,
    };
    this.bombMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.24, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5 }),
    );
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), lampMat);
    lamp.position.set(0.1, 0.15, 0);
    this.bombMesh.add(lamp);
    this.bombLampMat = lampMat;
    this.bombMesh.visible = false;
    game.scene.add(this.bombMesh);
    game.hud.onBuyItem = (id) => this.buyItem(id);
    game.hud.onDeploy = () => { if (this.state === 'buy') this.endBuy(); };
  }

  // ------------------------------------------------------------- match flow

  startMatch() {
    const game = this.game;
    this.score = [0, 0];
    this.round = 0;
    game.player.money = MATCH.startMoney;
    game.player.loadout.primary = null;
    game.player.loadout.current = 'sidearm';
    game.player.loadout.armor = false;
    game.player.loadout.frag = 0;
    game.player.loadout.smoke = 0;
    game.player.kills = 0;
    game.player.deaths = 0;
    game.stats.shots = 0;
    game.stats.hits = 0;
    game.hud.hideMatchEnd();
    game.hud.hideMenu();
    game.hud.show();
    this.startRound();
  }

  startRound() {
    const game = this.game;
    const { world, player } = game;
    this.round++;
    this.winner = -1;
    this.plantProgress = 0;
    this.defuseProgress = 0;

    // reset every fighter to a spawn slot, facing the fight (north for Wardens, south→north for Breakers)
    const wardens = game.actors.filter((a) => a.team === TEAM.WARDEN);
    const breakers = game.actors.filter((a) => a.team === TEAM.BREAKER);
    wardens.forEach((a, i) => a.reset(world.spawns.warden[i], 0));
    breakers.forEach((a, i) => a.reset(world.spawns.breaker[i], Math.PI));
    player.money = Math.min(MATCH.maxMoney, player.money);
    // the player's guns persist between rounds; magazines top up like a fresh spawn does
    for (const ws of [player.loadout.primary, player.loadout.sidearm]) {
      if (ws) { ws.mag = ws.def.mag; ws.reserve = ws.def.reserve; }
    }
    game.refreshHitTargets();

    // roles: Warden bots take hold spots (rotating each round), Breakers pick a site
    const bots = game.bots;
    const wardenBots = bots.filter((b) => b.team === TEAM.WARDEN);
    const breakerBots = bots.filter((b) => b.team === TEAM.BREAKER);
    const rotation = HOLD_ROTATION[(this.round - 1) % HOLD_ROTATION.length];
    wardenBots.forEach((bot, i) => bot.orderHold(game.nav.holdSpots[rotation[i]]));
    const siteIdx = Math.random() < 0.5 ? 0 : 1;
    const site = world.sites[siteIdx];
    const siteNode = siteIdx === 0 ? 3 : 4;
    const carrier = breakerBots[Math.floor(Math.random() * breakerBots.length)];
    breakerBots.forEach((bot, i) => {
      const guardPos = site.center.clone().add(GUARD_OFFSETS[i % GUARD_OFFSETS.length]);
      bot.orderPush(siteNode, bot === carrier ? null : guardPos);
      bot.isCarrier = bot === carrier;
    });
    game.bomb.state = 'carried';
    game.bomb.carrier = carrier;
    game.bomb.site = null;
    game.bomb.fuseLeft = 0;
    this.bombMesh.visible = false;

    // bot loadouts scale with the round: pistols first, rifles and armour after
    for (const bot of bots) this.equipBot(bot);

    this.state = 'buy';
    this.timer = MATCH.buySeconds;
    this.phaseLabel = `Round ${this.round}`;
    player.frozen = true;
    game.input.unlock();
    game.hud.showBuy(this.round, this.timer);
    game.hud.banner(`Round ${this.round}`, this.round === 1 ? 'Breakers are coming with a bomb. Hold the sites.' : `Score ${this.score[0]} — ${this.score[1]}`, '', 2.4);
    game.hud.spectate(false);
  }

  equipBot(bot) {
    const r = this.round;
    if (r < 2) return; // pistol round
    const pick = (bot.index + r) % 4;
    const key = pick === 0 ? 'wasp' : pick === 1 && bot.holdSpot?.site !== 'M' ? 'scatter' : pick === 2 && r >= 3 ? 'longshot' : 'carbine';
    giveWeapon(bot, key);
    bot.loadout.armor = true;
    if (r >= 3 && Math.random() < 0.4) bot.loadout.frag = 1;
  }

  endBuy() {
    const game = this.game;
    this.state = 'live';
    this.timer = MATCH.roundSeconds;
    game.hud.hideBuy();
    game.player.frozen = false;
    game.input.lock();
    game.hud.banner('Fight', '', '', 0.9);
  }

  endRound(winnerTeam, reason) {
    const game = this.game;
    if (this.state !== 'live') return;
    this.state = 'end';
    this.timer = MATCH.endSeconds;
    this.winner = winnerTeam;
    this.endReason = reason;
    this.score[winnerTeam]++;
    // payments
    const winPay = reason.includes('bomb') || reason.includes('defused') || reason.includes('detonated') ? PAY.winObjective : PAY.winElimination;
    // the player banks the win bonus on a Warden round, the loss bonus on a Breaker round
    game.player.money = Math.min(MATCH.maxMoney, game.player.money + (winnerTeam === TEAM.WARDEN ? winPay : PAY.loss));
    const won = winnerTeam === TEAM.WARDEN;
    game.hud.banner(won ? 'Wardens win the round' : 'Breakers win the round', reason, won ? 'win' : 'lose', 3.4);
    if (won) game.sound.roundWin(); else game.sound.roundLose();
    game.hud.spectate(false);
    game.hud.channel(null);
    game.player.frozen = true;
  }

  endMatch() {
    const game = this.game;
    this.state = 'matchEnd';
    game.hud.hideBuy();
    game.hud.channel(null);
    const [w, b] = this.score;
    const title = w > b ? 'Victory — Ember Yard holds' : w < b ? 'Defeat — the Yard falls' : 'Draw';
    const cls = w > b ? 'win' : w < b ? 'lose' : '';
    const acc = game.stats.shots > 0 ? Math.round((game.stats.hits / game.stats.shots) * 100) : 0;
    game.hud.showMatchEnd(title, `${w} — ${b}`,
      `${game.player.kills} kills · ${game.player.deaths} deaths · ${acc}% accuracy over ${this.round} rounds`, cls);
    game.input.unlock();
  }

  // ------------------------------------------------------------- shopping

  buyItem(id) {
    const game = this.game;
    const p = game.player;
    if (this.state !== 'buy') return;
    const item = BUY_ITEMS.find((i) => i.id === id);
    if (!item) return;
    const owned = game.hud.ownedLabel(id);
    if (owned === 'MAX' || p.money < item.price) { game.sound.denied(); return; }
    p.money -= item.price;
    if (id === 'armor') p.loadout.armor = true;
    else if (id === 'frag') p.loadout.frag++;
    else if (id === 'smoke') p.loadout.smoke++;
    else giveWeapon(p, id);
    game.sound.buy();
    game.hud.refreshBuy(this.timer);
  }

  // ------------------------------------------------------------- kills

  onKill(victim, attacker, headshot) {
    const game = this.game;
    if (victim.isPlayer) victim.die();
    else victim.die(game.time);
    if (attacker && attacker.isPlayer && victim.team !== attacker.team) {
      attacker.money = Math.min(MATCH.maxMoney, attacker.money + PAY.kill);
      attacker.kills++;
      game.sound.killConfirm();
    }
    game.hud.killfeed(attacker ?? { name: 'The bomb', team: victim.team }, victim,
      victim.lastWeaponName ?? (attacker ? currentWeapon(attacker).def.name : 'Explosion'), headshot);
    // the bomb drops where its carrier fell
    if (game.bomb.state === 'carried' && game.bomb.carrier === victim) {
      game.bomb.state = 'dropped';
      game.bomb.carrier = null;
      game.bomb.pos.copy(victim.pos);
      victim.isCarrier = false;
      this.bombMesh.position.copy(victim.pos).y += 0.14;
      this.bombMesh.visible = true;
      game.hud.banner('The bomb is down', 'Breakers must recover it', '', 1.8);
    }
    game.refreshHitTargets();
    this.checkWin();
  }

  aliveCount(team) {
    return this.game.actors.filter((a) => a.team === team && a.alive).length;
  }

  checkWin() {
    if (this.state !== 'live') return;
    const bomb = this.game.bomb;
    const wardensAlive = this.aliveCount(TEAM.WARDEN);
    const breakersAlive = this.aliveCount(TEAM.BREAKER);
    if (wardensAlive === 0) {
      if (bomb.state === 'planted') bomb.fuseLeft = Math.min(bomb.fuseLeft, 4); // nobody left to defuse
      else this.endRound(TEAM.BREAKER, 'Wardens eliminated');
    } else if (breakersAlive === 0 && bomb.state !== 'planted') {
      this.endRound(TEAM.WARDEN, 'Breakers eliminated');
    } else if (breakersAlive === 0 && bomb.state === 'planted' && !this.game.player.alive) {
      bomb.fuseLeft = Math.min(bomb.fuseLeft, 4); // only the player defuses; don't make bots wait out the fuse
    }
  }

  // ------------------------------------------------------------- per-step update

  update(dt, actions) {
    const game = this.game;
    const bomb = game.bomb;
    this.timerLow = false;

    if (this.state === 'buy') {
      this.timer -= dt;
      game.hud.refreshBuy(this.timer);
      for (const a of actions) {
        if (a.startsWith('slot')) {
          const idx = Number(a.slice(4)) - 1;
          if (BUY_ITEMS[idx]) this.buyItem(BUY_ITEMS[idx].id);
        }
        if (a === 'deploy' || a === 'buy') this.endBuy();
      }
      if (this.timer <= 0) this.endBuy();
      this.timerText = `0:${String(Math.max(0, Math.ceil(this.timer))).padStart(2, '0')}`;
      return;
    }

    if (this.state === 'end') {
      this.timer -= dt;
      this.timerText = '';
      if (this.timer <= 0) {
        const decided = this.score[0] >= MATCH.roundsToWin || this.score[1] >= MATCH.roundsToWin || this.round >= MATCH.maxRounds;
        if (decided) this.endMatch();
        else this.startRound();
      }
      return;
    }

    if (this.state !== 'live') return;

    // ---- live round
    const player = game.player;
    // player actions
    for (const a of actions) {
      if (!player.alive) break;
      if (a === 'reload') startReload(game, player);
      else if (a === 'slot1' && player.loadout.primary) this.switchWeapon('primary');
      else if (a === 'slot2') this.switchWeapon('sidearm');
      else if (a === 'lastWeapon') this.switchWeapon(player.loadout.lastSlot);
      else if (a === 'grenade') throwGrenade(game, player, 'frag');
      else if (a === 'grenadeAlt') throwGrenade(game, player, 'smoke');
    }

    // the clock: before a plant it is the Breakers' deadline; after, the fuse rules
    if (bomb.state !== 'planted') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.endRound(TEAM.WARDEN, 'Time expired — the bomb never went down');
        return;
      }
      const t = Math.max(0, Math.ceil(this.timer));
      this.timerText = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      this.timerLow = this.timer < 15;
    } else {
      bomb.fuseLeft -= dt;
      this.timerText = `0:${String(Math.max(0, Math.ceil(bomb.fuseLeft))).padStart(2, '0')}`;
      this.timerLow = true;
      // accelerating beeps
      const interval = bomb.fuseLeft < 5 ? 0.25 : bomb.fuseLeft < 15 ? 0.55 : 1.0;
      if (game.time >= this.beepAt) {
        this.beepAt = game.time + interval;
        game.sound.bombBeep(bomb.fuseLeft < 5);
        this.bombLampMat.emissiveIntensity = 5;
      }
      if (bomb.fuseLeft <= 0) {
        game.effects.explosion(_v.copy(bomb.pos).setY(bomb.pos.y + 0.6));
        game.sound.explosion(0);
        game.hud.shake(0.5);
        bomb.state = 'gone';
        this.endRound(TEAM.BREAKER, 'The bomb detonated');
        return;
      }
    }
    this.bombLampMat.emissiveIntensity = Math.max(0.6, this.bombLampMat.emissiveIntensity - dt * 14);

    // planting: the carrier channels while standing in a site
    const carrier = bomb.carrier;
    if (bomb.state === 'carried' && carrier && carrier.alive && carrier.planting) {
      this.plantProgress += dt;
      if (this.plantProgress >= MATCH.plantSeconds) {
        bomb.state = 'planted';
        bomb.site = nearestSite(game.world, carrier.pos);
        bomb.pos.copy(carrier.pos);
        bomb.fuseLeft = MATCH.bombFuseSeconds;
        carrier.isCarrier = false;
        bomb.carrier = null;
        if (carrier.isPlayer) carrier.money += PAY.plant;
        this.bombMesh.position.copy(bomb.pos).y += 0.14;
        this.bombMesh.visible = true;
        game.hud.banner('Bomb planted', `Site ${bomb.site.id} — defuse it or clear the Breakers out`, '', 2.6);
        game.sound.bombBeep(false);
        this.plantProgress = 0;
      }
    } else {
      this.plantProgress = Math.max(0, this.plantProgress - dt * 2);
    }

    // defusing: the player holds E on the planted bomb
    let channelFrac = null;
    if (bomb.state === 'planted' && player.alive) {
      const near = player.pos.distanceTo(bomb.pos) < 2.4;
      if (near && game.input.down('KeyE')) {
        this.defuseProgress += dt;
        channelFrac = this.defuseProgress / MATCH.defuseSeconds;
        if (Math.floor(this.defuseProgress * 4) !== Math.floor((this.defuseProgress - dt) * 4)) game.sound.channelTick();
        if (this.defuseProgress >= MATCH.defuseSeconds) {
          bomb.state = 'gone';
          this.bombMesh.visible = false;
          this.endRound(TEAM.WARDEN, 'Bomb defused');
          game.hud.channel(null);
          return;
        }
      } else {
        this.defuseProgress = Math.max(0, this.defuseProgress - dt * 3);
        if (near) channelFrac = this.defuseProgress / MATCH.defuseSeconds;
      }
    }
    game.hud.channel(channelFrac !== null && bomb.state === 'planted'
      ? 'Hold <kbd>E</kbd> — defusing' : null, channelFrac ?? 0);
    if (channelFrac === null) game.hud.channel(null);

    // spectate a living teammate once the player is down
    if (!player.alive) {
      game.hud.spectate(true);
      const mate = game.actors.find((a) => a.team === TEAM.WARDEN && a.alive && !a.isPlayer);
      if (mate) {
        const cam = game.camera;
        cam.position.set(mate.pos.x, mate.pos.y + 1.62, mate.pos.z);
        cam.rotation.order = 'YXZ';
        cam.rotation.y = mate.yaw;
        cam.rotation.x = -0.02;
        cam.rotation.z = 0;
      }
    }

    // dropped bomb pickup is handled by bots arriving (their 'fetch' order); if the player
    // walks over it nothing happens — the Wardens cannot carry the device.
    this.checkWin();
  }

  switchWeapon(slot) {
    const p = this.game.player;
    if (p.loadout.current === slot) return;
    if (slot === 'primary' && !p.loadout.primary) return;
    p.loadout.lastSlot = p.loadout.current;
    p.loadout.current = slot;
    p.reloading = false;
    p.shownWeaponKey = null;
  }
}

const _v = new THREE.Vector3();

function nearestSite(world, pos) {
  let best = world.sites[0], bd = Infinity;
  for (const s of world.sites) {
    const d = s.center.distanceTo(pos);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
