// DOM UI: main menu, HUD, buy panel, scoreboard, killfeed, radar, banners.
import { WEAPONS, UTILITIES } from '../../shared/weapons.ts';
import type { SnapHeader } from '../../shared/protocol.ts';
import type { PState } from '../../shared/protocol.ts';
import { floorCells, COLS, ROWS, CELL, PLANT_ZONES } from '../../shared/mapdef.ts';

export interface MenuStartArgs {
  name: string;
  teamSize: number;
  code: string;
}

export function el<T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T {
  const e = document.createElement(tag) as T;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ menu
export class Menu {
  root: HTMLElement;
  onStart: (a: MenuStartArgs) => void = () => {};
  private nameI: HTMLInputElement;
  private codeI: HTMLInputElement;
  private sizeSel: HTMLSelectElement;
  private err: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hidden');
    parent.appendChild(this.root);
    this.render();
    this.nameI = this.root.querySelector('#mname') as HTMLInputElement;
    this.codeI = this.root.querySelector('#mcode') as HTMLInputElement;
    this.sizeSel = this.root.querySelector('#msize') as HTMLSelectElement;
    this.err = this.root.querySelector('#err') as HTMLElement;
    const saved = localStorage.getItem('as.name');
    if (saved) this.nameI.value = saved;
    this.root.querySelector('#start')!.addEventListener('click', () => this.go());
  }

  private render(): void {
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="card">
        <div class="brand">REACTOR-09</div>
        <h1>AXIOM<span> SIEGE</span></h1>
        <div class="tag">ORIGINAL TACTICAL CORE · BOMB / DEFUSE · 5V5</div>
        <label class="fld">CALLSIGN
          <input id="mname" class="txt" maxlength="18" placeholder="HOSTILE" autocomplete="off" />
        </label>
        <label class="fld">MATCH SIZE
          <select id="msize" class="txt">
            <option value="1">1v1</option>
            <option value="2">2v2</option>
            <option value="3">3v3</option>
            <option value="5" selected>5v5</option>
          </select>
        </label>
        <label class="fld">ROOM CODE
          <input id="mcode" class="txt" maxlength="8" placeholder="make one up, share it" autocomplete="off" />
        </label>
        <div class="row">
          <button id="start" class="btn primary">JOIN MATCH</button>
        </div>
        <div id="err"></div>
        <div class="sub">
          <kbd>WASD</kbd> move · <kbd>MOUSE</kbd> look · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> zoom ·
          <kbd>R</kbd> reload · <kbd>E</kbd> plant/defuse · <kbd>B</kbd> buy · <kbd>1</kbd> rifle · <kbd>2</kbd> pistol · <kbd>3</kbd> knife ·
          <kbd>SHIFT</kbd> walk · <kbd>CTRL</kbd> crouch · <kbd>SPACE</kbd> jump · <kbd>TAB</kbd> score
        </div>
      </div>`;
  }

  private go(): void {
    const name = this.nameI.value.trim().slice(0, 18) || 'HOSTILE';
    localStorage.setItem('as.name', name);
    const teamSize = parseInt(this.sizeSel.value, 10) || 5;
    const code = this.codeI.value.trim().toLowerCase();
    if (code.length < 3) {
      this.err.textContent = 'Room code needs at least 3 characters.';
      return;
    }
    this.err.textContent = '';
    this.onStart({ name, teamSize, code });
  }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }
}

// ------------------------------------------------------------------ HUD
export interface Hud {
  show(): void;
  hide(): void;
  setMoney(m: number): void;
  setWeapon(name: string, mag: number, res: number): void;
  setBars(hp: number, armor: number): void;
  setBomb(has: boolean): void;
  setHeader(h: SnapHeader, winnerTeam: number | null): void;
  killfeed(k: { kid: string; kn: string; v: string; vn: string; w: string; hs: number }): void;
  banner(kind: 'round' | 'win' | 'loss' | 'info', text: string, sub?: string): void;
  plantProg(frac: number, kind: string): void;
  vignette(amt: number): void;
  flash(dur: number): void;
  crosshair(hit: boolean): void;
  scoreboard(players: PState[], h: SnapHeader, me: string): void;
  setSbOpen(v: boolean): void;
  setConnState(s: string): void;
  debug(text: string): void;
  scope(on: boolean): void;
  setHint(text: string): void;
}

export function buildHud(parent: HTMLElement): { hud: Hud; root: HTMLElement } {
  const root = el('div');
  root.id = 'hud';
  parent.appendChild(root);
  root.innerHTML = `
    <div class="el" id="topbar">
      <div id="score"><span class="t">0</span> : <span class="d">0</span></div>
      <div id="roundinfo"></div>
      <div id="roundtimer"></div>
    </div>
    <div class="el" id="kfeed"></div>
    <div class="el" id="statL">
      <div id="money">$0</div>
      <div id="weaponname"></div>
      <div id="ammo"></div>
      <div id="hpwrap"><span id="hpnum">100</span><div id="hpbar"><i></i></div></div>
      <div id="arwrap"><span id="arnum">0</span><div id="armorbar"><i></i></div></div>
      <div id="bombflag" class="hidden"></div>
    </div>
    <div class="el" id="center">
      <div id="banner"></div>
      <div id="hint" class="hidden"></div>
      <div id="plantmsg" class="hidden"></div>
      <div id="progwrap" class="hidden"><div id="prog"></div></div>
    </div>
    <div class="el" id="radar"><canvas width="160" height="160"></canvas><div class="lbl">RADAR</div></div>
    <div class="el" id="xh"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="ct"></i></div>
    <div class="el" id="vign"></div>
    <div class="el" id="screenflash"></div>
    <div class="el" id="pointer">CLICK TO PLAY · ESC TO RELEASE MOUSE</div>
    <div class="el hidden" id="debug"></div>
    <div class="el hidden" id="buypanel"><div class="box" id="buybox"></div></div>
    <div class="el hidden" id="scoreboard"><div class="box" id="sbbox"></div></div>
    <div class="el hidden" id="roundcard"><div class="inner"><div class="r"></div><div class="w"></div></div></div>
    <div class="el hidden" id="toast"></div>
  `;
  const $ = (id: string): HTMLElement => root.querySelector('#' + id)!;
  const ids: Record<string, HTMLElement> = {};
  for (const id of ['topbar', 'score', 'roundinfo', 'roundtimer', 'kfeed', 'statL', 'money',
    'weaponname', 'ammo', 'armorbar', 'hpbar', 'hpnum', 'arnum', 'bombflag', 'center', 'banner', 'hint', 'plantmsg',
    'progwrap', 'prog', 'radar', 'xh', 'vign', 'screenflash', 'pointer', 'debug',
    'buypanel', 'buybox', 'scoreboard', 'sbbox', 'roundcard', 'toast']) ids[id] = $(id);

  const sc = ids.score;
  const timer = ids.roundtimer;
  const phaseLbl = ids.roundinfo;

  const hud: Hud = {
    show() { root.classList.add('show'); },
    hide() { root.classList.remove('show'); },
    setMoney(m) { ids.money.textContent = '$' + m; },
    setWeapon(name, mag, res) {
      const w = WEAPONS[name];
      const u = UTILITIES[name];
      ids.weaponname.textContent = (w?.name || u?.name || name || 'knife').toUpperCase();
      if (mag >= 0) {
        ids.ammo.innerHTML = `${mag} <small>/ ${res >= 0 ? res : '-'}</small>`;
      } else {
        ids.ammo.textContent = w?.cat === 'melee' || !name ? '—' : '';
      }
    },
    setBars(hp, armor) {
      const h = Math.max(0, hp) / 100;
      ids.hpbar.querySelector('i')!.style.width = (h * 100) + '%';
      ids.armorbar.querySelector('i')!.style.width = (Math.max(0, armor) / 100 * 100) + '%';
      ids.hpnum.textContent = String(Math.max(0, Math.round(hp)));
      ids.hpnum.style.color = hp <= 25 ? 'var(--danger)' : 'var(--muted)';
      ids.arnum.textContent = String(Math.max(0, Math.round(armor)));
      ids.hpbar.style.visibility = 'visible';
      (ids.hpbar.parentElement as HTMLElement).style.visibility = 'visible';
      const arWrap = ids.armorbar.parentElement as HTMLElement;
      arWrap.style.visibility = armor <= 0 ? 'hidden' : 'visible';
    },
    setBomb(has) { ids.bombflag.classList.toggle('hidden', !has); ids.bombflag.textContent = 'C4 SECURED'; },
    setHeader(h, winnerTeam) {
      sc.querySelector('.t')!.textContent = String(h.scr[0]);
      sc.querySelector('.d')!.textContent = String(h.scr[1]);
      const sideT = h.atkTeam === 1 ? 'A' : 'D';
      let phase = '';
      if (h.ph === 'warmup') {
        phase = (h.pl ?? 0) < 2 ? `WARMUP · WAITING FOR PLAYERS (${h.pl ?? 0}/2)` : 'WARMUP';
        timer.textContent = fmt(h.wt);
      }
      else if (h.ph === 'freeze') { phase = `BUY · ROUND ${h.rnd}`; timer.textContent = fmt(h.bt); }
      else if (h.ph === 'live') {
        phase = h.plant > 0 ? 'BOMB ARMED · ' + (h.atkTeam === 1 ? 'ATTACK SIDE ' : 'DEF SIDE ') + sideT : `ROUND ${h.rnd}`;
        timer.textContent = fmt(h.boomIn > 0 ? h.boomIn : h.rt);
        if (h.boomIn > 0) timer.classList.add('armed');
        else timer.classList.remove('armed');
      } else if (h.ph === 'roundend') { phase = winnerTeam ? (winnerTeam === h.atkTeam ? 'ROUND LOST' : 'ROUND WON') : 'ROUND END'; timer.textContent = fmt(h.rt); }
      else if (h.ph === 'matchover') { phase = 'MATCH OVER'; timer.textContent = ''; }
      phaseLbl.textContent = phase;
    },
    killfeed(k) {
      const row = el('div', 'k');
      const wname = (WEAPONS[k.w]?.name || UTILITIES[k.w]?.name || k.w).toUpperCase();
      row.innerHTML = `<b>${esc(k.kn)}</b> <span class="w">[${wname}${k.hs ? ' · HS' : ''}]</span> <b>${esc(k.vn)}</b>`;
      ids.kfeed.appendChild(row);
      while (ids.kfeed.children.length > 6) ids.kfeed.removeChild(ids.kfeed.firstChild!);
      setTimeout(() => row.remove(), 6000);
    },
    banner(kind, text, sub) {
      const inner = ids.roundcard.querySelector('.inner')!;
      inner.querySelector('.r')!.textContent = text;
      const w = inner.querySelector('.w')!;
      w.textContent = sub || '';
      w.className = 'w ' + kind;
      ids.roundcard.classList.remove('hidden');
      void inner;
      (inner as HTMLElement).getAnimations?.().forEach((a: Animation) => a.cancel());
      (inner as HTMLElement).style.animation = 'none';
      void (inner as HTMLElement).offsetWidth;
      (inner as HTMLElement).style.animation = '';
      setTimeout(() => ids.roundcard.classList.add('hidden'), 2500);
    },
    plantProg(frac, kind) {
      ids.progwrap.classList.remove('hidden');
      ids.prog.style.width = (Math.max(0, Math.min(1, frac)) * 100) + '%';
      ids.plantmsg.textContent = kind === 'plant' ? 'PLANTING…' : 'DEFUSING…';
      ids.plantmsg.classList.remove('hidden');
    },
    vignette(amt) {
      ids.vign.classList.toggle('hit', amt > 0.3);
      if (amt <= 0.3) ids.vign.style.opacity = '0';
      else ids.vign.style.opacity = String(Math.min(1, amt));
    },
    flash(dur) {
      ids.screenflash.classList.add('on');
      ids.screenflash.style.transition = `opacity ${Math.max(0.2, dur)}s`;
      setTimeout(() => ids.screenflash.classList.remove('on'), 10);
      setTimeout(() => { ids.screenflash.style.opacity = '0'; }, dur * 1000);
    },
    crosshair(hit) { ids.xh.classList.toggle('hit', hit); },
    scoreboard(players, h, me) { renderScore(ids.sbbox, players, h, me); },
    setSbOpen(v) { ids.scoreboard.classList.toggle('hidden', !v); },
    setConnState(s) { ids.pointer.textContent = s; },
    debug(text) { ids.debug.textContent = text; ids.debug.classList.remove('hidden'); },
    scope(on) { ids.xh.classList.toggle('scoped', on); },
    setHint(text) { ids.hint.textContent = text; ids.hint.classList.toggle('hidden', !text); },
  };
  return { hud, root };
}

function renderScore(box: HTMLElement, players: PState[], h: SnapHeader, me: string): void {
  const teams = [players.filter((p) => p.team === 1), players.filter((p) => p.team === 2)];
  const lbl = h.atkTeam === 1 ? ['A', 'D'] : ['D', 'A'];
  box.innerHTML = `<h2>SCORE  <span style="color:var(--gold)">${h.scr[0]}</span> - <span style="color:var(--gold)">${h.scr[1]}</span> · ROUND ${h.rnd}</h2>`;
  const cols = `<div class="sb-row hd"><div class="n">PLAYER</div><div>K</div><div>D</div><div>$</div></div>`;
  for (let t = 0; t < 2; t++) {
    const atk = lbl[t] === 'A';
    const rows = teams[t]
      .slice()
      .sort((a, b) => b.kills - a.kills)
      .map((p) => `<div class="sb-row ${p.id === me ? 'me' : ''}"><div class="n">${esc(p.name)}${p.hasBomb ? ' [B]' : ''}</div><div>${p.kills}</div><div>${p.deaths}</div><div>${p.money}</div></div>`)
      .join('');
    box.insertAdjacentHTML('beforeend',
      `<div class="sb-team"><div class="tt ${atk ? 'atk' : 'def'}">${atk ? 'ATTACK' : 'DEFEND'}${h.plant > 0 && t === h.atkTeam - 1 ? ' · BOMB DOWN' : ''}</div>${cols}${rows || '<div class="sb-row"><div class="n">—</div></div>'}</div>`);
  }
}

// ------------------------------------------------------------------ radar
export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(parent: HTMLElement) {
    this.canvas = parent.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
  }
  draw(players: PState[], me: PState | undefined, header: SnapHeader): void {
    const ctx = this.ctx;
    const S = this.canvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, S, S);

    const range = 920;
    const scale = (S * 0.46) / range;
    const ox = me ? me.x : (COLS * CELL) / 2;
    const oz = me ? me.z : (ROWS * CELL) / 2;
    ctx.translate(S / 2, S / 2);
    if (me) ctx.rotate(-me.yaw);

    ctx.fillStyle = '#1a2736';
    const cellPx = CELL * scale;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!floorCells[r * COLS + c]) continue;
        const x = ((c + 0.5) * CELL - ox) * scale;
        const y = ((r + 0.5) * CELL - oz) * scale;
        ctx.fillRect(x - cellPx / 2, y - cellPx / 2, cellPx + 0.4, cellPx + 0.4);
      }
    }

    for (const z of PLANT_ZONES) {
      const x = (z.x - ox) * scale, y = (z.z - oz) * scale;
      ctx.strokeStyle = header.plant === z.site ? '#ff5d5d' : '#ffd166';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = header.plant === z.site ? '#ff5d5d' : '#ffd166';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.site === 1 ? 'A' : 'B', x, y);
      ctx.globalAlpha = 1;
    }

    for (const p of players) {
      if (!p.alive) continue;
      const x = (p.x - ox) * scale, y = (p.z - oz) * scale;
      if (x * x + y * y > (S / 2) * (S / 2)) continue;
      const isMe = !!(me && p.id === me.id);
      const ally = me ? p.team === me.team : true;
      ctx.fillStyle = isMe ? '#e8f0ff' : ally ? (p.team === 2 ? '#54b8ff' : '#ff8a4c') : (p.team === 2 ? '#54b8ff' : '#ff8a4c');
      ctx.beginPath();
      ctx.arc(x, y, isMe ? 4.2 : 3.1, 0, Math.PI * 2);
      ctx.fill();
      if (p.hasBomb) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 5, y - 5, 10, 10);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(140,170,210,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ buy
export interface BuyCallbacks {
  onBuy: (item: string) => void;
}
export function buildBuyPanel(panel: HTMLElement, me: PState | undefined, cb: BuyCallbacks): { open: (b: boolean) => void; isOpen: () => boolean } {
  const groups: { cat: string; items: string[] }[] = [
    { cat: 'RIFLES', items: Object.keys(WEAPONS).filter((k) => WEAPONS[k].cat === 'rifle').sort((a, b) => WEAPONS[a].price - WEAPONS[b].price) },
    { cat: 'SMG / SHOTGUN', items: Object.keys(WEAPONS).filter((k) => WEAPONS[k].cat === 'smg' || WEAPONS[k].cat === 'shotgun').sort((a, b) => WEAPONS[a].price - WEAPONS[b].price) },
    { cat: 'SNIPER / LMG', items: Object.keys(WEAPONS).filter((k) => WEAPONS[k].cat === 'sniper' || WEAPONS[k].cat === 'lmg').sort((a, b) => WEAPONS[a].price - WEAPONS[b].price) },
    { cat: 'PISTOLS', items: Object.keys(WEAPONS).filter((k) => WEAPONS[k].cat === 'pistol').sort((a, b) => WEAPONS[a].price - WEAPONS[b].price) },
    { cat: 'GEAR & UTILITY', items: ['armor', 'helmet', ...Object.keys(UTILITIES)] },
  ];
  panel.innerHTML = '<h2>ARMORY</h2><div class="hint" id="buyhint">B / ESC to close</div><div id="buygrid"></div>';
  const grid = panel.querySelector('#buygrid')!;
  const moneyHint = panel.querySelector('#buyhint') as HTMLElement;
  let open = false;

  const draw = () => {
    moneyHint.textContent = `ARMORY   ·   FUNDS $${me ? me.money : 0}   ·   B / ESC to close`;
    grid.innerHTML = '';
    for (const g of groups) {
      const h = el('div', 'cat', g.cat);
      h.style.gridColumn = '1 / -1';
      h.style.marginTop = '8px';
      grid.appendChild(h);
      for (const id of g.items) {
        const w = WEAPONS[id];
        const u = UTILITIES[id];
        const price = w ? w.price : u ? u.price : id === 'armor' ? 650 : 1000;
        const owned = !!(me && id === 'armor' && me.armor >= 100);
        const poor = !!(me && me.money < price);
        const btn = el<HTMLButtonElement>('button', 'item' + (owned ? ' owned' : '') + (poor ? ' poor' : ''));
        const nm = w ? w.name : u ? u.name : id === 'armor' ? 'Kevlar Vest' : id === 'helmet' ? 'Helmet Kit' : id;
        btn.innerHTML = `<div class="cat">${w ? w.cat : (u ? 'util' : 'gear')}</div><div class="nm">${nm}</div><div class="st">${stat(id, w, u)}</div><div class="pr">$${price}</div>`;
        btn.disabled = poor || owned;
        btn.addEventListener('click', () => { if (!btn.disabled) cb.onBuy(id); });
        grid.appendChild(btn);
      }
    }
  };
  const isOpen = () => open;
  return {
    open(v) { open = v; panel.classList.toggle('hidden', !v); if (v) draw(); },
    isOpen,
  };
}
function stat(id: string, w: (typeof WEAPONS)[string] | undefined, u: (typeof UTILITIES)[string] | undefined): string {
  if (w) return `${w.cat.toUpperCase()} · ${w.dmg} DMG · ${w.rpm} RPM · ${w.mag}/${w.reserve}`;
  if (u) return `${u.price}$ · up to ${u.maxCarry}`;
  if (id === 'armor') return 'full vest';
  if (id === 'helmet') return 'helmet (headshot resist)';
  return '';
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
