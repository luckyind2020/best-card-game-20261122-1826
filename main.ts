// Crown of Embers — headless entrypoint.
//
// Simulates a full AI-vs-AI duel using the exact same rules module the
// browser game uses (game/rules.js), then prints the turn log and the
// result. Fully deterministic: the same seed always prints the same match.
// A short 20-seed balance check follows, so the pacing can be verified.
//
// Run:  node main.ts
// Play: open game/index.html in a desktop browser.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { simulateMatch, START_LIFE } = require("./game/rules.js");

const SEED = 20261122;

function main(): void {
  const game = simulateMatch(SEED);
  const s = game.summary();

  console.log("Crown of Embers — AI vs AI exhibition match");
  console.log(`Seed: ${s.seed}   Life: ${START_LIFE} each   Deck: 36 cards per side`);
  console.log("--------------------------------------------------");
  for (const line of game.log) {
    console.log(line);
  }
  console.log("--------------------------------------------------");
  console.log(`Result: ${s.winner} wins in ${s.turns} turns (${s.plays} cards played).`);
  console.log(`Final life — You ${s.life[0]} : Rival ${s.life[1]}.`);

  // Balance check: 20 fresh seeds, first-player win share should sit
  // near half — the extra opening card, the skipped opening draw and the
  // Rival's opening Ward shield offset going second.
  let firstWins = 0;
  let totalTurns = 0;
  for (let i = 0; i < 20; i++) {
    const g = simulateMatch(1000 + i);
    if (g.winner === 0) firstWins++;
    totalTurns += g.summary().turns;
  }
  console.log(
    `Balance check (20 seeds): first player won ${firstWins}/20, ` +
      `average match length ${(totalTurns / 20).toFixed(1)} turns.`
  );
}

main();
