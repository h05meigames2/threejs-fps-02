// The DOM HUD: vitals, ammo, purse, top bar, kill feed, banners, buy menu, channel prompt,
// damage feedback and a canvas minimap. Everything is cached element references and writes
// happen only when a value changes, so the HUD costs nothing measurable per frame. Round
// state flows in from the round manager through update(); purchases flow out via onBuyItem.

import { TEAM, WEAPONS, ARMOR_PRICE, GRENADES } from './config.js';
import { currentWeapon, spreadFor } from './weapons.js';

export const BUY_ITEMS = [
  { id: 'carbine', label: 'VK-7 Carbine', price: WEAPONS.carbine.price },
  { id: 'longshot', label: 'Longshot DMR', price: WEAPONS.longshot.price },
  { id: 'scatter', label: 'Scattergun', price: WEAPONS.scatter.price },
  { id: 'wasp', label: 'Wasp SMG', price: WEAPONS.wasp.price },
  { id: 'armor', label: 'Vest + Helmet', price: ARMOR_PRICE },
  { id: 'frag', label: 'Frag grenade', price: GRENADES.frag.price },
  { id: 'smoke', label: 'Smoke grenade', price: GRENADES.smoke.price },
];

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      healthNum: $('health-num'), healthBar: document.querySelector('#healthbar i'),
      armorTag: $('armor-tag'), ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
      weaponName: $('weapon-name'), nades: $('nades'), purse: $('purse'),
      timer: $('timer'), phaseLbl: $('phase-lbl'), scoreW: $('score-w'), scoreB: $('score-b'),
      pipsW: $('pips-w'), pipsB: $('pips-b'), bombtag: $('bombtag'), bombSite: $('bomb-site'), bombFuse: $('bomb-fuse'),
      killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      prompt: $('prompt'), promptText: $('prompt-text'), channelBar: document.querySelector('#channel i'),
      spectate: $('spectate'), hurt: $('hurt'), dirhit: $('dirhit'),
      menu: $('menu'), buymenu: $('buymenu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
      buyTimer: $('buy-timer'), buyRound: $('buy-round'), matchend: $('matchend'),
      endTitle: $('end-title'), finalScore: $('final-score'), finalStats: $('final-stats'),
      minimap: $('minimap'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.cache = {};
    this.hitUntil = 0;
    this.hurtUntil = 0;
    this.dirhitUntil = 0;
    this.bannerUntil = 0;
    this.shakeAmp = 0;
    this.shakeOffset = { x: 0, y: 0, z: 0 };
    this.mmAt = 0;
    this.onBuyItem = null;
    this.onDeploy = null;
    this.buildBuyGrid();
    $('deploy').addEventListener('click', () => this.onDeploy && this.onDeploy());
  }

  buildBuyGrid() {
    BUY_ITEMS.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'buy-item';
      btn.dataset.item = item.id;
      btn.innerHTML = `<span class="key">${i + 1}</span><span class="nm">${item.label}</span>` +
        `<span class="pr">$${item.price}</span><span class="own"></span>`;
      btn.addEventListener('click', () => this.onBuyItem && this.onBuyItem(item.id));
      this.el.buyGrid.appendChild(btn);
      item.button = btn;
      item.ownEl = btn.querySelector('.own');
    });
  }

  set(key, value, apply) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      apply(value);
    }
  }

  show() { this.el.hud.hidden = false; }
  hideMenu() { this.el.menu.hidden = true; }
  showMatchEnd(title, scoreText, statsText, cls) {
    this.el.endTitle.textContent = title;
    this.el.endTitle.style.color = cls === 'win' ? 'var(--teal)' : cls === 'lose' ? 'var(--rust)' : 'var(--ink)';
    this.el.finalScore.textContent = scoreText;
    this.el.finalStats.textContent = statsText;
    this.el.matchend.hidden = false;
  }
  hideMatchEnd() { this.el.matchend.hidden = true; }

  banner(title, sub, cls = '', seconds = 2.6) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerTitle.className = cls;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('on');
    this.bannerUntil = this.game.time + seconds;
  }

  killfeed(killer, victim, weaponName, headshot) {
    const row = document.createElement('div');
    row.className = 'row';
    const kc = killer.team === TEAM.WARDEN ? 'w' : 'b';
    const vc = victim.team === TEAM.WARDEN ? 'w' : 'b';
    row.innerHTML = `<span class="${kc}">${killer.name}</span> <span class="wpn">[${weaponName}${headshot ? ' <span class="hs">headshot</span>' : ''}]</span> <span class="${vc}">${victim.name}</span>`;
    this.el.killfeed.appendChild(row);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 5200);
  }

  hitmarker(head, kill) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('head', !!head);
    hm.classList.toggle('kill', !!kill);
    hm.style.opacity = 1;
    this.hitUntil = this.game.time + 0.16;
  }

  damageFlash(fromPos) {
    const p = this.game.player;
    this.hurtUntil = this.game.time + 0.45;
    this.el.hurt.style.opacity = 0.9;
    if (fromPos && p) {
      const bearing = Math.atan2(-(fromPos.x - p.pos.x), -(fromPos.z - p.pos.z));
      const rel = bearing - p.yaw;
      this.el.dirhit.style.transform = `rotate(${rel}rad)`;
      this.el.dirhit.style.opacity = 0.95;
      this.dirhitUntil = this.game.time + 0.6;
    }
  }

  shake(amount) { this.shakeAmp = Math.min(0.5, this.shakeAmp + amount); }

  channel(label, frac) {
    if (frac === null || frac === undefined) {
      this.el.prompt.hidden = true;
      return;
    }
    this.el.prompt.hidden = false;
    this.el.promptText.innerHTML = label;
    this.el.channelBar.style.width = `${Math.round(frac * 100)}%`;
  }

  spectate(on) { this.el.spectate.hidden = !on; }

  // ------------------------------------------------------------- buy menu

  showBuy(round, secondsLeft) {
    this.el.buymenu.hidden = false;
    this.el.buyRound.textContent = round;
    this.refreshBuy(secondsLeft);
  }
  hideBuy() { this.el.buymenu.hidden = true; }
  refreshBuy(secondsLeft) {
    const p = this.game.player;
    this.el.buyMoney.textContent = `$${p.money}`;
    this.el.buyTimer.textContent = Math.ceil(secondsLeft);
    for (const item of BUY_ITEMS) {
      const owned = this.ownedLabel(item.id);
      item.button.disabled = owned === 'MAX' || p.money < item.price;
      item.ownEl.textContent = owned === '' ? '' : owned === 'MAX' ? 'Equipped / full' : owned;
    }
  }
  ownedLabel(id) {
    const l = this.game.player.loadout;
    if (id === 'armor') return l.armor ? 'MAX' : '';
    if (id === 'frag') return l.frag >= 2 ? 'MAX' : l.frag > 0 ? `Carrying ${l.frag}` : '';
    if (id === 'smoke') return l.smoke >= 2 ? 'MAX' : l.smoke > 0 ? `Carrying ${l.smoke}` : '';
    return l.primary && l.primary.key === id ? 'MAX' : '';
  }

  // ------------------------------------------------------------- per-frame refresh

  update(dt) {
    const game = this.game;
    const p = game.player;
    const now = game.time;
    if (!p) return;

    // timed fades
    if (this.hitUntil && now > this.hitUntil) { this.el.hitmarker.style.opacity = 0; this.hitUntil = 0; }
    if (this.hurtUntil && now > this.hurtUntil) { this.el.hurt.style.opacity = 0; this.hurtUntil = 0; }
    if (this.dirhitUntil && now > this.dirhitUntil) { this.el.dirhit.style.opacity = 0; this.dirhitUntil = 0; }
    if (this.bannerUntil && now > this.bannerUntil) { this.el.banner.classList.remove('on'); this.bannerUntil = 0; }
    if (this.shakeAmp > 0.001) {
      this.shakeAmp *= Math.pow(0.001, dt);
      this.shakeOffset.x = (Math.random() * 2 - 1) * this.shakeAmp * 0.14;
      this.shakeOffset.y = (Math.random() * 2 - 1) * this.shakeAmp * 0.14;
      this.shakeOffset.z = (Math.random() * 2 - 1) * this.shakeAmp * 0.05;
    } else this.shakeOffset.x = this.shakeOffset.y = this.shakeOffset.z = 0;

    // vitals
    const hp = Math.max(0, Math.ceil(p.health));
    this.set('hp', hp, (v) => {
      this.el.healthNum.textContent = v;
      this.el.healthNum.classList.toggle('low', v <= 30);
      this.el.healthBar.style.width = `${v}%`;
      this.el.healthBar.classList.toggle('low', v <= 30);
    });
    this.set('armor', p.loadout.armor, (v) => {
      this.el.armorTag.innerHTML = v ? '<b>Armoured</b> · vest + helmet' : 'No armour';
    });

    // weapon + ammo
    const ws = currentWeapon(p);
    this.set('wpn', ws.key, (v) => { this.el.weaponName.textContent = WEAPONS[v].name; });
    this.set('mag', ws.mag, (v) => {
      this.el.ammoMag.textContent = p.reloading ? '––' : v;
      this.el.ammo.classList.toggle('empty', v === 0);
    });
    this.set('res', ws.reserve, (v) => { this.el.ammoReserve.textContent = `/ ${v}`; });
    this.set('nades', `${p.loadout.frag}|${p.loadout.smoke}`, () => {
      this.el.nades.textContent = `Frag ×${p.loadout.frag} (G) · Smoke ×${p.loadout.smoke} (F)`;
    });
    this.set('money', p.money, (v) => { this.el.purse.textContent = `$${v}`; });

    // crosshair spread
    const spd = 4 + spreadFor(p, ws.def) * 340;
    this.el.crosshair.style.setProperty('--spd', `${spd.toFixed(1)}px`);
    this.el.crosshair.style.opacity = p.alive && game.round.state !== 'buy' ? 1 : 0;

    // top bar from round state
    const r = game.round;
    this.set('timer', r.timerText, (v) => {
      this.el.timer.textContent = v;
      this.el.timer.classList.toggle('low', r.timerLow);
    });
    this.set('phase', r.phaseLabel, (v) => { this.el.phaseLbl.textContent = v; });
    this.set('sw', r.score[0], (v) => { this.el.scoreW.textContent = v; });
    this.set('sb', r.score[1], (v) => { this.el.scoreB.textContent = v; });
    const aliveW = game.actors.filter((a) => a.team === TEAM.WARDEN && a.alive).length;
    const aliveB = game.actors.filter((a) => a.team === TEAM.BREAKER && a.alive).length;
    this.set('aw', aliveW, (v) => { this.el.pipsW.textContent = '●'.repeat(v) + '○'.repeat(4 - v); });
    this.set('ab', aliveB, (v) => { this.el.pipsB.textContent = '●'.repeat(v) + '○'.repeat(4 - v); });
    if (game.bomb.state === 'planted') {
      this.el.bombtag.hidden = false;
      this.el.bombSite.textContent = game.bomb.site.id;
      this.set('fuse', Math.ceil(game.bomb.fuseLeft), (v) => { this.el.bombFuse.textContent = v; });
    } else this.el.bombtag.hidden = true;

    if (now >= this.mmAt) {
      this.mmAt = now + 0.12;
      this.drawMinimap();
    }
  }

  drawMinimap() {
    const ctx = this.mmCtx;
    const S = 172, W2M = S / 76; // world 76m across
    const px = (x) => (x + 38) * W2M;
    const pz = (z) => (z + 38) * W2M;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(24,28,34,0.9)';
    ctx.fillRect(0, 0, S, S);
    // warehouse + catwalk + sites
    ctx.fillStyle = 'rgba(126,147,168,0.5)';
    ctx.fillRect(px(-8), pz(-12), 16 * W2M, 16 * W2M);
    ctx.fillStyle = 'rgba(255,140,58,0.4)';
    ctx.fillRect(px(-13), pz(6), 26 * W2M, 3 * W2M);
    for (const [site, color] of [[this.game.world.sites[0], '#2fbfae'], [this.game.world.sites[1], '#e06432']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px(site.center.x), pz(site.center.z), site.radius * W2M, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '700 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(site.id, px(site.center.x), pz(site.center.z) + 3.5);
    }
    // bomb
    if (this.game.bomb.state !== 'carried' || this.game.bomb.blink) {
      const b = this.game.bomb;
      const pos = b.state === 'carried' && b.carrier ? b.carrier.pos : b.pos;
      if (pos) {
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.arc(px(pos.x), pz(pos.z), 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // actors: teammates always; enemies only just after they fire (muzzle report)
    const now = this.game.time;
    for (const a of this.game.actors) {
      if (!a.alive) continue;
      if (a.isPlayer) continue;
      const visible = a.team === TEAM.WARDEN || now - a.lastShotAt < 1.6;
      if (!visible) continue;
      ctx.fillStyle = a.team === TEAM.WARDEN ? '#2fbfae' : '#e06432';
      ctx.beginPath();
      ctx.arc(px(a.pos.x), pz(a.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // the player: an arrow facing view direction
    const p = this.game.player;
    ctx.save();
    ctx.translate(px(p.pos.x), pz(p.pos.z));
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    ctx.rotate(Math.atan2(fx, -fz));
    ctx.fillStyle = '#ece7db';
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(3.8, 4.5);
    ctx.lineTo(-3.8, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
