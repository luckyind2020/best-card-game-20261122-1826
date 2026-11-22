// Crown of Embers — shared deterministic rules core.
// Used by both the headless entrypoint (main.ts) and the browser game
// (game/game.js). Pure logic: no DOM, no network, no unseeded randomness.

const SUITS = {
  spades: { symbol: "♠", name: "Spades", color: "#2b2b3a", power: "Pierce", powerText: "+2 damage" },
  hearts: { symbol: "♥", name: "Hearts", color: "#c0392b", power: "Mend", powerText: "heal half its attack" },
  clubs: { symbol: "♣", name: "Clubs", color: "#1e6b3a", power: "Rally", powerText: "draw 1 card" },
  diamonds: { symbol: "♦", name: "Diamonds", color: "#b8860b", power: "Ward", powerText: "gain shield equal to attack" },
};

const RANKS = [
  { label: "6", value: 6, cost: 1 },
  { label: "7", value: 7, cost: 1 },
  { label: "8", value: 8, cost: 1 },
  { label: "9", value: 9, cost: 2 },
  { label: "10", value: 10, cost: 2 },
  { label: "J", value: 11, cost: 2 },
  { label: "Q", value: 12, cost: 3 },
  { label: "K", value: 13, cost: 3 },
  { label: "A", value: 14, cost: 3 },
];

const START_LIFE = 60;
const START_HAND = 4;
const MAX_HAND = 7;
const MAX_ENERGY = 5;

// Deterministic PRNG (mulberry32). Every match is reproducible from a seed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck() {
  const deck = [];
  let id = 0;
  for (const suitKey of Object.keys(SUITS)) {
    for (const rank of RANKS) {
      deck.push({
        id: id++,
        suit: suitKey,
        symbol: SUITS[suitKey].symbol,
        suitName: SUITS[suitKey].name,
        color: SUITS[suitKey].color,
        power: SUITS[suitKey].power,
        powerText: SUITS[suitKey].powerText,
        label: rank.label,
        attack: rank.value,
        cost: rank.cost,
        name: `${rank.label} of ${SUITS[suitKey].name}`,
      });
    }
  }
  return deck;
}

function shuffle(deck, rng) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function freshSide(seed, extraCards = 0) {
  const rng = makeRng(seed);
  const deck = shuffle(buildDeck(), rng);
  const hand = deck.splice(0, START_HAND + extraCards);
  return { life: START_LIFE, shield: 0, energy: 0, maxEnergy: 0, deck, hand, discard: [] };
}

// A full match. `seed` drives both shuffles; `log` collects human-readable lines.
class EmberGame {
  constructor(seed = 20261122) {
    this.seed = seed;
    this.rng = makeRng(seed ^ 0x9e3779b9);
    // The second player draws one extra opening card to offset going second.
    this.players = [freshSide(seed), freshSide(seed + 777, 1)];
    this.turn = 1; // turn number (shared clock); side 0 moves on odd turns
    this.active = 0; // side whose turn it is
    this.over = false;
    this.winner = null; // 0 | 1 | null
    this.plays = 0;
    this.log = [];
    // The second player opens behind a small Ward shield, balancing the
    // tempo of moving first.
    this.players[1].shield = 8;
    this.log.push("Rival opens behind an 8-point Ward shield.");
    this.startTurn();
  }

  sideName(i) {
    return i === 0 ? "You" : "Rival";
  }

  energyForTurn(n) {
    // Slow ramp: 2 energy for the first two turns, then +1 every two turns.
    return Math.min(2 + Math.floor((n - 1) / 2), MAX_ENERGY);
  }

  startTurn() {
    const p = this.players[this.active];
    p.maxEnergy = this.energyForTurn(this.turn);
    p.energy = p.maxEnergy;
    // The first player opens without drawing, so going first is not a
    // free card on top of the tempo advantage.
    if (this.turn === 1 && this.active === 0) {
      this.log.push(
        `Turn ${this.turn} — ${this.sideName(this.active)} begins with ${p.energy} energy, life ${p.life} (no opening draw).`
      );
    } else {
      this.draw(this.active, 1);
      this.log.push(
        `Turn ${this.turn} — ${this.sideName(this.active)} begins with ${p.energy} energy, life ${p.life}.`
      );
    }
  }

  draw(side, n) {
    const p = this.players[side];
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        if (p.discard.length === 0) return;
        p.deck = shuffle(p.discard, this.rng);
        p.discard = [];
        this.log.push(`${this.sideName(side)} reshuffles the discard pile.`);
      }
      if (p.hand.length >= MAX_HAND) {
        p.discard.push(p.deck.shift());
        continue;
      }
      p.hand.push(p.deck.shift());
    }
  }

  // Play hand[handIndex] for `side`. Returns { ok, reason?, card?, damage? }.
  playCard(side, handIndex) {
    if (this.over) return { ok: false, reason: "match is over" };
    if (side !== this.active) return { ok: false, reason: "not your turn" };
    const me = this.players[side];
    const foe = this.players[1 - side];
    const card = me.hand[handIndex];
    if (!card) return { ok: false, reason: "no such card" };
    if (card.cost > me.energy) return { ok: false, reason: "not enough energy" };

    me.hand.splice(handIndex, 1);
    me.discard.push(card);
    me.energy -= card.cost;
    this.plays++;

    let damage = card.attack;
    let notes = [];
    if (card.suit === "spades") {
      damage += 2;
      notes.push("Pierce +2");
    }
    const blocked = Math.min(foe.shield, damage);
    if (blocked > 0) {
      foe.shield -= blocked;
      damage -= blocked;
      notes.push(`Ward blocked ${blocked}`);
    }
    foe.life = Math.max(0, foe.life - damage);
    if (card.suit === "hearts") {
      const heal = Math.floor(card.attack / 2);
      me.life = Math.min(START_LIFE, me.life + heal);
      notes.push(`Mend +${heal}`);
    }
    if (card.suit === "clubs") {
      this.draw(side, 1);
      notes.push("Rally draws 1");
    }
    if (card.suit === "diamonds") {
      me.shield += card.attack;
      notes.push(`Ward +${card.attack}`);
    }
    this.log.push(
      `${this.sideName(side)} plays ${card.name} (${card.attack} atk, ${card.cost} energy)` +
        (damage > 0 ? ` — ${damage} damage to ${this.sideName(1 - side)}` : "") +
        (notes.length ? ` [${notes.join(", ")}]` : "") +
        `. Life ${me.life} vs ${foe.life}.`
    );
    this.checkEnd();
    return { ok: true, card, damage };
  }

  endTurn() {
    if (this.over) return;
    this.log.push(`${this.sideName(this.active)} ends turn ${this.turn}.`);
    this.active = 1 - this.active;
    this.turn++;
    this.startTurn();
  }

  checkEnd() {
    for (let i = 0; i < 2; i++) {
      if (this.players[i].life <= 0) {
        this.over = true;
        this.winner = 1 - i;
        this.log.push(
          `${this.sideName(1 - i)} wins — ${this.sideName(i)} falls to 0 life after ${this.turn} turns and ${this.plays} cards played.`
        );
        return;
      }
    }
  }

  // Simple greedy AI: keep playing the affordable card with the best
  // (damage + suit bonus) value until nothing affordable remains.
  aiTakeTurn(side) {
    while (!this.over) {
      const me = this.players[side];
      let best = -1;
      let bestScore = -1;
      for (let i = 0; i < me.hand.length; i++) {
        const c = me.hand[i];
        if (c.cost > me.energy) continue;
        let score = c.attack;
        if (c.suit === "spades") score += 2;
        if (c.suit === "hearts" && me.life < START_LIFE) score += 3;
        if (c.suit === "clubs") score += 1;
        if (c.suit === "diamonds") score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) break;
      this.playCard(side, best);
    }
    if (!this.over) this.endTurn();
  }

  summary() {
    return {
      seed: this.seed,
      turns: this.turn,
      plays: this.plays,
      winner: this.winner === null ? null : this.sideName(this.winner),
      life: [this.players[0].life, this.players[1].life],
      over: this.over,
    };
  }
}

// Run a whole AI-vs-AI match and return the game. Deterministic for a seed.
function simulateMatch(seed = 20261122) {
  const game = new EmberGame(seed);
  let guard = 0;
  while (!game.over && guard++ < 500) {
    game.aiTakeTurn(game.active);
  }
  return game;
}

// Dual-format footer: the same file runs as a classic browser script
// (exposes window.CrownRules) and as a Node module (module.exports),
// so main.ts and the browser game share one rules implementation.
const CrownRules = {
  SUITS, RANKS, START_LIFE, START_HAND, MAX_HAND, MAX_ENERGY,
  makeRng, buildDeck, shuffle, EmberGame, simulateMatch,
};
if (typeof module !== "undefined" && module.exports) module.exports = CrownRules;
if (typeof window !== "undefined") window.CrownRules = CrownRules;
