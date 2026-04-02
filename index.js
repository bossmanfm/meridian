import "dotenv/config";
import cron from "node-cron";
import readline from "readline";
import { execSync } from "child_process";
import { agentLoop } from "./agent.js";
import { log } from "./logger.js";
import { getMyPositions } from "./tools/dlmm.js";
import { getWalletBalances } from "./tools/wallet.js";
import { getTopCandidates, enrichCandidates } from "./tools/screening.js";
import { config, reloadScreeningThresholds } from "./config.js";
import { evolveThresholds, getPerformanceSummary } from "./lessons.js";
import { registerCronRestarter } from "./tools/executor.js";
import { startPolling, stopPolling, sendMessage, sendHTML, notifyOutOfRange, isEnabled as telegramEnabled } from "./telegram.js";
import { generateBriefing } from "./briefing.js";
import { initMemory, recallForScreening, recallForManagement, rememberPositionSnapshot } from "./memory.js";
import { updatePnlAndCheckExits } from "./state.js";

log("startup", "DLMM LP Agent starting...");
log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
log("startup", `Model: ${process.env.LLM_MODEL || "deepseek-chat"}`);

// Initialize holographic memory at startup
initMemory();

const TP_PCT  = config.management.takeProfitFeePct;
const DEPLOY  = config.management.deployAmountSol;

// ═══════════════════════════════════════════
//  CYCLE TIMERS
// ═══════════════════════════════════════════
const timers = {
  managementLastRun: null,
  screeningLastRun: null,
};

function nextRunIn(lastRun, intervalMin) {
  if (!lastRun) return intervalMin * 60;
  const elapsed = (Date.now() - lastRun) / 1000;
  return Math.max(0, intervalMin * 60 - elapsed);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildPrompt() {
  const mgmt  = formatCountdown(nextRunIn(timers.managementLastRun, config.schedule.managementIntervalMin));
  const scrn  = formatCountdown(nextRunIn(timers.screeningLastRun,  config.schedule.screeningIntervalMin));
  return `[manage: ${mgmt} | screen: ${scrn}]\n> `;
}

// ═══════════════════════════════════════════
//  CRON DEFINITIONS
// ═══════════════════════════════════════════
let _cronTasks = [];
let _managementBusy = false;
let _screeningBusy = false;

function stopCronJobs() {
  for (const task of _cronTasks) task.stop();
  _cronTasks = [];
}

function startCronJobs() {
  stopCronJobs(); // stop any running tasks before (re)starting

  const mgmtTask = cron.schedule(`*/${Math.max(1, config.schedule.managementIntervalMin)} * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    timers.managementLastRun = Date.now();
    log("cron", `Starting management cycle [model: ${config.llm.managementModel}]`);
    try {
      // Targeted recall + trailing TP / stop loss pre-check
      let memoryHints = "";
      let exitAlerts = "";
      try {
        const pos = await getMyPositions();
        const recalls = [];
        const exits = [];
        for (const p of pos.positions || []) {
          // Memory recall
          const hits = recallForManagement(p);
          for (const h of hits) {
            recalls.push(`[${h.source}] ${h.key}: ${h.answer} (confidence: ${(h.confidence * 100).toFixed(0)}%)`);
          }
          // Store mid-position snapshot in nuggets
          rememberPositionSnapshot(p);

          // Trailing TP / stop loss check
          if (p.pnl_pct != null) {
            const exitAction = updatePnlAndCheckExits(p.position, p.pnl_pct, config);
            if (exitAction) {
              exits.push(`⚠ ${p.pair}: ${exitAction}`);
              log("exit_check", `${p.pair}: ${exitAction}`);
            }
          }
        }
        if (recalls.length > 0) {
          memoryHints = `\n\nMEMORY RECALL (from past sessions):\n${recalls.join("\n")}\n`;
        }
        if (exits.length > 0) {
          exitAlerts = `\n\nEXIT ALERTS (CLOSE THESE IMMEDIATELY):\n${exits.join("\n")}\n`;
        }
      } catch { /* best-effort */ }

      const pos = await getMyPositions();
      const positionBlocks = (pos.positions || []).map((p) => {
        const inRange = p.in_range ? "✅" : "❌";
        const pnl = p.pnl_pct != null ? `${p.pnl_pct >= 0 ? "+" : ""}${p.pnl_pct.toFixed(2)}%` : "n/a";
        const unclaimed = p.unclaimed_fee_usd ? `$${p.unclaimed_fee_usd.toFixed(2)}` : "$0";
        const age = p.age_minutes != null ? `${p.age_minutes}m` : "n/a";
        const range = p.in_range ? `${p.lower_bin}→${p.upper_bin}` : `OOR: ${p.lower_bin}→${p.upper_bin}`;
        return `[${p.pair || p.pool}] ${inRange} | Age: ${age} | Unclaimed: ${unclaimed} | PnL: ${pnl} | Range: ${range} | Fee/TVL: ${p.fee_per_tvl_24h?.toFixed(2) || "n/a"}%`;
      }).join("\n") || "No open positions";

      const { content } = await agentLoop(`
⚙️ MANAGEMENT — ${pos.positions?.length || 0} pos

DATA:
${positionBlocks}${memoryHints}${exitAlerts}

CLOSE RULES (first match wins):
1. instruction met → CLOSE | 2. instruction NOT met → HOLD
3. PnL <= ${config.management.emergencyPriceDropPct}% → CLOSE | 4. PnL >= ${config.management.takeProfitFeePct}% → CLOSE
5. active_bin > upper+${config.management.outOfRangeBinsToClose} → CLOSE | 6. OOR >= ${config.management.outOfRangeWaitMinutes}min → CLOSE
7. fee/TVL < ${config.management.minFeePerTvl24h} AND age>=60min → CLOSE

LESSON: Don't close too early! 20 positions closed at 0% with peak +50%+ missed.
Trailing TP: trigger at ${config.management.trailingTakeProfit ? config.management.trailingTriggerPct : 5}%, drop ${config.management.trailingTakeProfit ? config.management.trailingDropPct : 3}% — let position breathe!

Close: call close_position only (includes claim). Claim separately if unclaimed >= ${config.management.minClaimAmount}.

INSTRUCTIONS: Data pre-loaded — no fetching. Apply rules, report immediately. Only tool call if CLOSE/CLAIM needed.

REPORT FORMAT (one line per position):
**[PAIR]** — PnL [X]% — [STAY/CLOSE]
End with: 💼 [N] pos | $[value]
      `, config.llm.maxSteps, [], "MANAGER", config.llm.managementModel, 4096);
      if (telegramEnabled() && content) sendMessage(content).catch(() => {});
    } catch (error) {
      log("cron_error", `Management cycle failed: ${error.message}`);
      if (telegramEnabled()) sendMessage(`Management failed: ${error.message}`).catch(() => {});
    } finally {
      _managementBusy = false;
      const pos = await getMyPositions().catch(() => null);
      for (const p of pos?.positions || []) {
        if (!p.in_range && p.minutes_out_of_range >= config.management.outOfRangeWaitMinutes) {
          notifyOutOfRange({ pair: p.pair, minutesOOR: p.minutes_out_of_range }).catch(() => {});
        }
      }
    }
  });

  const screenTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, async () => {
    if (_screeningBusy) return;

    // Hard guards — don't even run the agent if preconditions aren't met
    try {
      const [positions, balance] = await Promise.all([getMyPositions(), getWalletBalances()]);
      if (positions.total_positions >= config.risk.maxPositions) {
        log("cron", `Screening skipped — max positions reached (${positions.total_positions}/${config.risk.maxPositions})`);
        return;
      }
      if (balance.sol < config.management.minSolToOpen) {
        log("cron", `Screening skipped — insufficient SOL (${balance.sol.toFixed(3)} < ${config.management.minSolToOpen})`);
        return;
      }
    } catch (e) {
      log("cron_error", `Screening pre-check failed: ${e.message}`);
      return;
    }

    _screeningBusy = true;
    timers.screeningLastRun = Date.now();
    log("cron", `Starting screening cycle [model: ${config.llm.screeningModel}]`);
    try {
      // Fetch candidates with OKX enrichment
      const rawCandidates = await getTopCandidates({ limit: 5 });
      const candidates = rawCandidates.candidates || [];
      const enrichedCandidates = await enrichCandidates(candidates);
      
      // Build candidate context
      const candidateContext = enrichedCandidates.length > 0
        ? `\n\nTOP CANDIDATES (with OKX enrichment):\n${enrichedCandidates.map((c, i) => 
            `${i+1}. **${c.pool_name}**\n   fee/TVL: ${(c.fee_active_tvl_ratio*100).toFixed(1)}% | vol: ${c.volatility?.toFixed(1)} | organic: ${c.organic_score}\n   bots: ${c.bundlers_pct?.toFixed(1)}% | top10: ${c.top_10_real_holders_pct?.toFixed(1)}%\n   OKX risk: ${c.okx_risk_score}/100 | smart: ${c.okx_smart_wallet_count} | wash: ${c.okx_wash_trade_detected ? "⚠️" : "✅"}`
          ).join("\n\n")}`
        : "\n\nNo eligible candidates found this cycle.";
      
      // Get current state
      const prePositions = await getMyPositions();
      const currentBalance = await getWalletBalances();
      const deployAmount = config.risk.deployAmountSol;
      
      const strategyBlock = ""; // strategy guidance block (from strategy library)
      // Targeted recall: recall strategy memories for common bin steps
      let memoryHints = "";
      try {
        const recalls = [];
        // Recall strategies for common bin steps we use
        for (const bs of [80, 100, 125]) {
          const hits = recallForScreening({ bin_step: bs });
          for (const h of hits) recalls.push(h);
        }
        // Recall any pool memories from recent positions
        const recentPos = await getMyPositions();
        for (const p of recentPos.positions || []) {
          const hits = recallForScreening({ name: p.pair });
          for (const h of hits) {
            if (!recalls.some(x => x.key === h.key)) recalls.push(h);
          }
        }
        if (recalls.length > 0) {
          memoryHints = `\n\nMEMORY RECALL (from past sessions):\n${recalls.map(h => `[${h.source}] ${h.key}: ${h.answer}`).join("\n")}\n`;
        }
      } catch { /* memory recall is best-effort */ }

      const { content } = await agentLoop(`
🔍 SCREENING
Positions: ${prePositions.total_positions}/${config.risk.maxPositions} | SOL: ${currentBalance.sol.toFixed(3)} | Deploy: ${deployAmount} SOL
${candidateContext}${memoryHints}

HARD RULES (skip if any match):
• fees < ${config.screening.minTokenFeesSol} SOL (scam/bundled)
• bots > ${config.screening.maxBundlersPct}% OR top10 > ${config.screening.maxTop10Pct}%
• blocked launchpad/token
• volatility < 4 (LESSON: low vol pools lose money — Chicky-SOL vol=3.14 FAILED)
• pool has bad history (win rate <30% AND avg PnL <-5% over 3+ deployments) — check pool memory
• OKX risk score > 50 (high rug probability)
• OKX wash trade detected (fake volume)
• OKX honeypot detected

PREFER (from lessons + OKX):
• volatility ≥5 (high vol = better performance)
• fee/TVL >3%, volume >$10k/h
• smart wallets present (OKX smart_wallet_count ≥3)
• pool with good history (win rate ≥60%, avg PnL ≥3%)
• OKX risk score < 30 (low risk)
• OKX real volume ≥80% (quality volume)

DEPLOY: Call deploy_position (bin pre-fetched). bins_below = 35-90 based on vol.

Report EXACT format:
✅ DEPLOY: PAIR — [X] SOL
fee=X% | bots=X% | vol=X.XX | OKX risk: XX/100
smart: [count] wallets | wash: ✅/⚠️
why: <one sentence>
      `, config.llm.maxSteps, [], "SCREENER", config.llm.screeningModel, 2048);
      if (telegramEnabled() && content) sendMessage(content).catch(() => {});
    } catch (error) {
      log("cron_error", `Screening cycle failed: ${error.message}`);
      if (telegramEnabled()) sendMessage(`Screening failed: ${error.message}`).catch(() => {});
    } finally {
      _screeningBusy = false;
    }
  });

  const healthTask = cron.schedule(`0 * * * *`, async () => {
    if (_managementBusy) return;
    _managementBusy = true;
    log("cron", "Starting health check");
    try {
      await agentLoop(`
HEALTH CHECK

Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
      `, config.llm.maxSteps, [], "MANAGER");
    } catch (error) {
      log("cron_error", `Health check failed: ${error.message}`);
    } finally {
      _managementBusy = false;
    }
  });

  // Morning Briefing at 8:00 AM UTC+7 (1:00 AM UTC)
  const briefingTask = cron.schedule(`0 1 * * *`, async () => {
    log("cron", "Starting morning briefing");
    try {
      const briefing = await generateBriefing();
      if (telegramEnabled()) {
        await sendHTML(briefing);
      }
    } catch (error) {
      log("cron_error", `Morning briefing failed: ${error.message}`);
    }
  }, { timezone: 'UTC' });

  _cronTasks = [mgmtTask, screenTask, healthTask, briefingTask];
  log("cron", `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
}

// ═══════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════
async function shutdown(signal) {
  log("shutdown", `Received ${signal}. Shutting down...`);
  stopPolling();
  const positions = await getMyPositions();
  log("shutdown", `Open positions at shutdown: ${positions.total_positions}`);
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", (sig) => {
  let trace = "unavailable";
  try {
    const ppid = process.ppid;
    const psInfo = execSync(`ps -p ${ppid} -o pid,ppid,comm 2>/dev/null`).toString().trim();
    const children = execSync(`pgrep -P ${process.pid} 2>/dev/null`).toString().trim();
    trace = `parent=${psInfo}, children=${children || "none"}, stack=${new Error().stack}`;
  } catch(e) { trace = `trace error: ${e.message}`; }
  log("shutdown", `SIGTERM received. Trace: ${trace}`);
  shutdown("SIGTERM");
});

// ═══════════════════════════════════════════
//  FORMAT CANDIDATES TABLE
// ═══════════════════════════════════════════
function formatCandidates(candidates) {
  if (!candidates.length) return "  No eligible pools found right now.";

  const lines = candidates.map((p, i) => {
    const name   = (p.name || "unknown").padEnd(20);
    const ftvl   = `${p.fee_active_tvl_ratio ?? p.fee_tvl_ratio}%`.padStart(8);
    const vol    = `$${((p.volume_24h || 0) / 1000).toFixed(1)}k`.padStart(8);
    const active = `${p.active_pct}%`.padStart(6);
    const org    = String(p.organic_score).padStart(4);
    return `  [${i + 1}]  ${name}  fee/aTVL:${ftvl}  vol:${vol}  in-range:${active}  organic:${org}`;
  });

  return [
    "  #   pool                  fee/aTVL     vol    in-range  organic",
    "  " + "─".repeat(68),
    ...lines,
  ].join("\n");
}

// ═══════════════════════════════════════════
//  INTERACTIVE REPL
// ═══════════════════════════════════════════
const isTTY = process.stdin.isTTY;
let cronStarted = false;
let busy = false;
const sessionHistory = []; // persists conversation across REPL turns
const MAX_HISTORY = 20;    // keep last 20 messages (10 exchanges)

function appendHistory(userMsg, assistantMsg) {
  sessionHistory.push({ role: "user", content: userMsg });
  sessionHistory.push({ role: "assistant", content: assistantMsg });
  // Trim to last MAX_HISTORY messages
  if (sessionHistory.length > MAX_HISTORY) {
    sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);
  }
}

// Register restarter — when update_config changes intervals, running cron jobs get replaced
registerCronRestarter(() => { if (cronStarted) startCronJobs(); });

if (isTTY) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });

  // Update prompt countdown every 10 seconds
  setInterval(() => {
    if (!busy) {
      rl.setPrompt(buildPrompt());
      rl.prompt(true); // true = preserve current line
    }
  }, 10_000);

  function launchCron() {
    if (!cronStarted) {
      cronStarted = true;
      // Seed timers so countdown starts from now
      timers.managementLastRun = Date.now();
      timers.screeningLastRun  = Date.now();
      startCronJobs();
      console.log("Autonomous cycles are now running.\n");
      rl.setPrompt(buildPrompt());
      rl.prompt(true);
    }
  }

  async function runBusy(fn) {
    if (busy) { console.log("Agent is busy, please wait..."); rl.prompt(); return; }
    busy = true; rl.pause();
    try { await fn(); }
    catch (e) { console.error(`Error: ${e.message}`); }
    finally { busy = false; rl.setPrompt(buildPrompt()); rl.resume(); rl.prompt(); }
  }

  // ── Startup: show wallet + top candidates ──
  console.log(`
╔═══════════════════════════════════════════╗
║         DLMM LP Agent — Ready             ║
╚═══════════════════════════════════════════╝
`);

  console.log("Fetching wallet and top pool candidates...\n");

  busy = true;
  let startupCandidates = [];

  try {
    const [wallet, positions, { candidates, total_eligible, total_screened }] = await Promise.all([
      getWalletBalances(),
      getMyPositions(),
      getTopCandidates({ limit: 5 }),
    ]);

    startupCandidates = candidates;

    console.log(`Wallet:    ${wallet.sol} SOL  ($${wallet.sol_usd})  |  SOL price: $${wallet.sol_price}`);
    console.log(`Positions: ${positions.total_positions} open\n`);

    if (positions.total_positions > 0) {
      console.log("Open positions:");
      for (const p of positions.positions) {
        const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
        console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
      }
      console.log();
    }

    console.log(`Top pools (${total_eligible} eligible from ${total_screened} screened):\n`);
    console.log(formatCandidates(candidates));

  } catch (e) {
    console.error(`Startup fetch failed: ${e.message}`);
  } finally {
    busy = false;
  }

  // Always start autonomous cycles on launch
  launchCron();

  // Telegram bot
  startPolling(async (text) => {
    if (_managementBusy || _screeningBusy || busy) {
      sendMessage("Agent is busy right now — try again in a moment.").catch(() => {});
      return;
    }

    if (text === "/briefing") {
      try {
        const briefing = await generateBriefing();
        await sendHTML(briefing);
      } catch (e) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
      return;
    }

    busy = true;
    try {
      log("telegram", `Incoming: ${text}`);
      const { content } = await agentLoop(text, config.llm.maxSteps, sessionHistory, "GENERAL", config.llm.generalModel);
      appendHistory(text, content);
      await sendMessage(content);
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    } finally {
      busy = false;
      rl.setPrompt(buildPrompt());
      rl.prompt(true);
    }
  });

  console.log(`
Commands:
  1 / 2 / 3 ...  Deploy ${DEPLOY} SOL into that pool
  auto           Let the agent pick and deploy automatically
  /status        Refresh wallet + positions
  /candidates    Refresh top pool list
  /briefing      Show morning briefing (last 24h)
  /learn         Study top LPers from the best current pool and save lessons
  /learn <addr>  Study top LPers from a specific pool address
  /thresholds    Show current screening thresholds + performance stats
  /evolve        Manually trigger threshold evolution from performance data
  /stop          Shut down
`);

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ── Number pick: deploy into pool N ─────
    const pick = parseInt(input);
    if (!isNaN(pick) && pick >= 1 && pick <= startupCandidates.length) {
      await runBusy(async () => {
        const pool = startupCandidates[pick - 1];
        console.log(`\nDeploying ${DEPLOY} SOL into ${pool.name}...\n`);
        const { content: reply } = await agentLoop(
          `Deploy ${DEPLOY} SOL into pool ${pool.pool} (${pool.name}). Call get_active_bin first then deploy_position. Report result.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── auto: agent picks and deploys ───────
    if (input.toLowerCase() === "auto") {
      await runBusy(async () => {
        console.log("\nAgent is picking and deploying...\n");
        const { content: reply } = await agentLoop(
          `get_top_candidates, pick the best one, get_active_bin, deploy_position with ${DEPLOY} SOL. Execute now, don't ask.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── go: start cron without deploying ────
    if (input.toLowerCase() === "go") {
      launchCron();
      rl.prompt();
      return;
    }

    // ── Slash commands ───────────────────────
    if (input === "/stop") { await shutdown("user command"); return; }

    if (input === "/status") {
      await runBusy(async () => {
        const [wallet, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
        console.log(`\nWallet: ${wallet.sol} SOL  ($${wallet.sol_usd})`);
        console.log(`Positions: ${positions.total_positions}`);
        for (const p of positions.positions) {
          const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
          console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
        }
        console.log();
      });
      return;
    }

    if (input === "/briefing") {
      await runBusy(async () => {
        const briefing = await generateBriefing();
        console.log(`\n${briefing.replace(/<[^>]*>/g, "")}\n`);
      });
      return;
    }

    if (input === "/candidates") {
      await runBusy(async () => {
        const { candidates, total_eligible, total_screened } = await getTopCandidates({ limit: 5 });
        startupCandidates = candidates;
        console.log(`\nTop pools (${total_eligible} eligible from ${total_screened} screened):\n`);
        console.log(formatCandidates(candidates));
        console.log();
      });
      return;
    }

    if (input === "/thresholds") {
      const s = config.screening;
      console.log("\nCurrent screening thresholds:");
      console.log(`  maxVolatility:    ${s.maxVolatility}`);
      console.log(`  minFeeTvlRatio:   ${s.minFeeTvlRatio}`);
      console.log(`  minOrganic:       ${s.minOrganic}`);
      console.log(`  minHolders:       ${s.minHolders}`);
      console.log(`  maxPriceChangePct: ${s.maxPriceChangePct}`);
      console.log(`  timeframe:        ${s.timeframe}`);
      const perf = getPerformanceSummary();
      if (perf) {
        console.log(`\n  Based on ${perf.total_positions_closed} closed positions`);
        console.log(`  Win rate: ${perf.win_rate_pct}%  |  Avg PnL: ${perf.avg_pnl_pct}%`);
      } else {
        console.log("\n  No closed positions yet — thresholds are preset defaults.");
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith("/learn")) {
      await runBusy(async () => {
        const parts = input.split(" ");
        const poolArg = parts[1] || null;

        let poolsToStudy = [];

        if (poolArg) {
          poolsToStudy = [{ pool: poolArg, name: poolArg }];
        } else {
          // Fetch top 10 candidates across all eligible pools
          console.log("\nFetching top pool candidates to study...\n");
          const { candidates } = await getTopCandidates({ limit: 10 });
          if (!candidates.length) {
            console.log("No eligible pools found to study.\n");
            return;
          }
          poolsToStudy = candidates.map((c) => ({ pool: c.pool, name: c.name }));
        }

        console.log(`\nStudying top LPers across ${poolsToStudy.length} pools...\n`);
        for (const p of poolsToStudy) console.log(`  • ${p.name || p.pool}`);
        console.log();

        const poolList = poolsToStudy
          .map((p, i) => `${i + 1}. ${p.name} (${p.pool})`)
          .join("\n");

        const { content: reply } = await agentLoop(
          `Study top LPers across these ${poolsToStudy.length} pools by calling study_top_lpers for each:

${poolList}

For each pool, call study_top_lpers then move to the next. After studying all pools:
1. Identify patterns that appear across multiple pools (hold time, scalping vs holding, win rates).
2. Note pool-specific patterns where behaviour differs significantly.
3. Derive 4-8 concrete, actionable lessons using add_lesson. Prioritize cross-pool patterns — they're more reliable.
4. Summarize what you learned.

Focus on: hold duration, entry/exit timing, what win rates look like, whether scalpers or holders dominate.`,
          config.llm.maxSteps,
          [],
          "GENERAL"
        );
        console.log(`\n${reply}\n`);
      });
      return;
    }

    if (input === "/evolve") {
      await runBusy(async () => {
        const perf = getPerformanceSummary();
        if (!perf || perf.total_positions_closed < 5) {
          const needed = 5 - (perf?.total_positions_closed || 0);
          console.log(`\nNeed at least 5 closed positions to evolve. ${needed} more needed.\n`);
          return;
        }
        const fs = await import("fs");
        const lessonsData = JSON.parse(fs.default.readFileSync("./lessons.json", "utf8"));
        const result = evolveThresholds(lessonsData.performance, config);
        if (!result || Object.keys(result.changes).length === 0) {
          console.log("\nNo threshold changes needed — current settings already match performance data.\n");
        } else {
          reloadScreeningThresholds();
          console.log("\nThresholds evolved:");
          for (const [key, val] of Object.entries(result.changes)) {
            console.log(`  ${key}: ${result.rationale[key]}`);
          }
          console.log("\nSaved to user-config.json. Applied immediately.\n");
        }
      });
      return;
    }

    // ── /lesson — Check auto-lesson performance ─────────────────
    if (input === "/lesson") {
      try {
        const { getLessonPerformance } = await import("./auto-lesson.js");
        const perf = getLessonPerformance();
        console.log("\n📚 AUTO-LESSON PERFORMANCE");
        console.log("=" .repeat(50));
        if (perf.message) {
          console.log(perf.message);
        } else {
          console.log(`Total Closed: ${perf.totalClosed}`);
          console.log(`Win Rate: ${perf.overallWinRate}`);
          console.log(`Avg Missed Profit: ${perf.avgMissedProfit}%`);
          console.log("\nBy Volatility:");
          console.log(`  Low (<4): ${perf.byVolatility.low.count} positions, avg PnL ${perf.byVolatility.low.avgPnl}%`);
          console.log(`  Med (4-6): ${perf.byVolatility.medium.count} positions, avg PnL ${perf.byVolatility.medium.avgPnl}%`);
          console.log(`  High (≥6): ${perf.byVolatility.high.count} positions, avg PnL ${perf.byVolatility.high.avgPnl}%`);
          console.log("\nCurrent Config (auto-adjusted):");
          console.log(`  Trailing TP: ${perf.currentConfig.trailingTP}`);
          console.log(`  Min Volatility: ${perf.currentConfig.minVolatility}`);
          console.log(`  Min Fee/TVL: ${perf.currentConfig.minFeeTvl}`);
          console.log(`  Max Positions: ${perf.currentConfig.maxPositions}`);
          console.log(`  Deploy Amount: ${perf.currentConfig.deployAmount}`);
        }
        console.log("=" .repeat(50));
      } catch (e) {
        console.log(`\nError: ${e.message}\n`);
      }
      return;
    }

    // ── /pool — Check pool memory ─────────────────
    if (input.startsWith("/pool")) {
      try {
        const { getAllPoolMemory, getPoolLesson } = await import("./pool-memory.js");
        const memory = getAllPoolMemory();
        const pools = Object.keys(memory);
        
        console.log("\n🏊 POOL MEMORY");
        console.log("=" .repeat(50));
        
        if (pools.length === 0) {
          console.log("No pool history yet");
        } else if (input === "/pool") {
          console.log(`Total pools tracked: ${pools.length}\n`);
          for (const addr of pools.slice(0, 10)) {
            const pool = memory[addr];
            const winRate = pool.stats.totalDeployments > 0 
              ? (pool.stats.winCount / pool.stats.totalDeployments * 100).toFixed(0) 
              : 0;
            const avgPnl = pool.stats.totalDeployments > 0
              ? (pool.stats.totalPnlPct / pool.stats.totalDeployments).toFixed(1)
              : 0;
            console.log(`  ${pool.pool_name}: ${pool.stats.totalDeployments}x, ${winRate}% win, ${avgPnl}% avg`);
          }
          if (pools.length > 10) {
            console.log(`  ... and ${pools.length - 10} more`);
          }
        } else {
          // /pool <name> — get specific pool details
          const searchName = input.replace("/pool", "").trim().toLowerCase();
          const found = Object.entries(memory).find(([_, p]) => p.pool_name.toLowerCase().includes(searchName));
          if (found) {
            const [addr, pool] = found;
            const lesson = getPoolLesson(addr);
            console.log(`\n📍 ${pool.pool_name}`);
            console.log(`   Deployments: ${pool.stats.totalDeployments}`);
            console.log(`   Win Rate: ${(pool.stats.winCount/pool.stats.totalDeployments*100).toFixed(0)}%`);
            console.log(`   Avg PnL: ${(pool.stats.totalPnlPct/pool.stats.totalDeployments).toFixed(1)}%`);
            console.log(`   Avg Range Eff: ${pool.stats.avgRangeEfficiency.toFixed(0)}%`);
            console.log(`   Avg Hold: ${pool.stats.avgMinutesHeld.toFixed(0)} min`);
            if (lesson) {
              console.log(`\n   Lesson: [${lesson.outcome}] ${lesson.lesson}`);
            }
          } else {
            console.log(`Pool "${searchName}" not found`);
          }
        }
        console.log("=" .repeat(50));
      } catch (e) {
        console.log(`\nError: ${e.message}\n`);
      }
      return;
    }

    // ── Free-form chat ───────────────────────
    await runBusy(async () => {
      log("user", input);
      const { content } = await agentLoop(input, config.llm.maxSteps, sessionHistory, "GENERAL", config.llm.generalModel);
      appendHistory(input, content);
      console.log(`\n${content}\n`);
    });
  });

  rl.on("close", () => shutdown("stdin closed"));

} else {
  // Non-TTY: start immediately
  log("startup", "Non-TTY mode — starting cron cycles immediately.");
  startCronJobs();
  (async () => {
    try {
      await agentLoop(`
STARTUP CHECK
1. get_wallet_balance. 2. get_my_positions. 3. If SOL >= ${config.management.minSolToOpen}: get_top_candidates then deploy ${DEPLOY} SOL. 4. Report.
      `, config.llm.maxSteps, [], "SCREENER");
    } catch (e) {
      log("startup_error", e.message);
    }
  })();
}
