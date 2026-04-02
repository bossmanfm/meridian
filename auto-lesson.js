// ─── AUTO-ADJUST ALL CONFIG BASED ON LESSONS ─────────────
// Every closed position triggers learning across all parameters

import { config } from './config.js';
import { log } from './logger.js';
import fs from 'fs';

const _performanceHistory = [];
const CONFIG_FILE = './user-config.json';

// Track performance by category
export function recordPerformance(positionData) {
  const record = {
    pool_name: positionData.pool_name,
    volatility: parseFloat(positionData.volatility || 0),
    fee_tvl_ratio: parseFloat(positionData.fee_tvl_ratio || 0),
    organic_score: parseFloat(positionData.organic_score || 0),
    bin_step: positionData.bin_step || 0,
    strategy: positionData.strategy || 'unknown',
    peak_pnl_pct: parseFloat(positionData.peak_pnl_pct || 0),
    exit_pnl_pct: parseFloat(positionData.pnl_pct || 0),
    missed_profit: (parseFloat(positionData.peak_pnl_pct || 0) - parseFloat(positionData.pnl_pct || 0)),
    deployed_at: positionData.deployed_at,
    closed_at: new Date().toISOString(),
  };
  
  _performanceHistory.push(record);
  if (_performanceHistory.length > 50) {
    _performanceHistory.shift(); // Keep last 50
  }
  
  // Run all auto-adjustments
  const adjustments = {
    trailing: adjustTrailingTP(record),
    volatility: adjustVolatilityThresholds(),
    feeTvl: adjustFeeTvlThresholds(),
    positions: adjustMaxPositions(),
    deployAmount: adjustDeployAmount(),
  };
  
  // Save config if any adjustment made
  const anyAdjusted = Object.values(adjustments).some(a => a.adjusted);
  if (anyAdjusted) {
    saveConfig();
  }
  
  return adjustments;
}

// 1. TRAILING TP (already implemented, simplified here)
function adjustTrailingTP(record) {
  const { peak_pnl_pct, exit_pnl_pct, missed_profit } = record;
  let adjusted = false;
  let newTrigger = config.management.trailingTriggerPct;
  let newDrop = config.management.trailingDropPct;
  
  if (peak_pnl_pct > 5 && exit_pnl_pct < 1) {
    newTrigger = Math.min(10, newTrigger + 1);
    newDrop = Math.min(5, newDrop + 0.5);
    adjusted = true;
    log("auto_lesson", `CLOSED TOO EARLY: peak=${peak_pnl_pct}% exit=${exit_pnl_pct}% → TP ${newTrigger}%/${newDrop}%`);
  } else if (missed_profit > 3 && peak_pnl_pct > 3) {
    newTrigger = Math.min(10, newTrigger + 0.5);
    newDrop = Math.min(5, newDrop + 0.25);
    adjusted = true;
  } else if (exit_pnl_pct >= newTrigger * 0.8) {
    newTrigger = Math.max(3, newTrigger - 0.25);
    newDrop = Math.max(1.5, newDrop - 0.1);
    adjusted = true;
    log("auto_lesson", `PERFECT EXIT: exit=${exit_pnl_pct}% → TP ${newTrigger}%/${newDrop}% (aggressive)`);
  }
  
  config.management.trailingTriggerPct = Math.round(newTrigger * 100) / 100;
  config.management.trailingDropPct = Math.round(newDrop * 100) / 100;
  
  return { adjusted, newTrigger: config.management.trailingTriggerPct, newDrop: config.management.trailingDropPct };
}

// 2. VOLATILITY THRESHOLDS
function adjustVolatilityThresholds() {
  if (_performanceHistory.length < 5) return { adjusted: false };
  
  const lowVol = _performanceHistory.filter(p => p.volatility < 4);
  const highVol = _performanceHistory.filter(p => p.volatility >= 5);
  
  const lowVolAvgPnl = lowVol.length ? lowVol.reduce((s, p) => s + p.exit_pnl_pct, 0) / lowVol.length : 0;
  const highVolAvgPnl = highVol.length ? highVol.reduce((s, p) => s + p.exit_pnl_pct, 0) / highVol.length : 0;
  
  let adjusted = false;
  let newMinVol = config.screening.minVolatility || 0;
  
  // If low vol keeps losing, raise threshold
  if (lowVol.length >= 3 && lowVolAvgPnl < -2) {
    newMinVol = Math.min(5, newMinVol + 0.5);
    adjusted = true;
    log("auto_lesson", `LOW VOL FAILING: avg PnL=${lowVolAvgPnl.toFixed(1)}% → minVol ${newMinVol}`);
  }
  
  // If high vol consistently wins, ensure threshold allows it
  if (highVol.length >= 5 && highVolAvgPnl > 3 && newMinVol > 4.5) {
    newMinVol = Math.max(4, newMinVol - 0.5);
    adjusted = true;
    log("auto_lesson", `HIGH VOL WINNING: avg PnL=${highVolAvgPnl.toFixed(1)}% → minVol ${newMinVol}`);
  }
  
  config.screening.minVolatility = Math.round(newMinVol * 100) / 100;
  return { adjusted, newMinVol: config.screening.minVolatility, lowVolAvgPnl, highVolAvgPnl };
}

// 3. FEE/TVL THRESHOLDS
function adjustFeeTvlThresholds() {
  if (_performanceHistory.length < 5) return { adjusted: false };
  
  const highFee = _performanceHistory.filter(p => p.fee_tvl_ratio > 0.05);
  const lowFee = _performanceHistory.filter(p => p.fee_tvl_ratio < 0.03);
  
  const highFeeWinRate = highFee.length ? highFee.filter(p => p.exit_pnl_pct > 0).length / highFee.length : 0;
  const lowFeeWinRate = lowFee.length ? lowFee.filter(p => p.exit_pnl_pct > 0).length / lowFee.length : 0;
  
  let adjusted = false;
  let newMinFee = config.screening.minFeeActiveTvlRatio || 0.05;
  
  // If high fee pools win more, raise threshold
  if (highFee.length >= 3 && highFeeWinRate > 0.7) {
    newMinFee = Math.min(0.1, newMinFee + 0.005);
    adjusted = true;
    log("auto_lesson", `HIGH FEE WINS: winRate=${(highFeeWinRate*100).toFixed(0)}% → minFee/Tvl ${newMinFee.toFixed(3)}`);
  }
  
  // If threshold too high and no deals, lower it
  if (_performanceHistory.filter(p => p.fee_tvl_ratio >= newMinFee).length === 0 && newMinFee > 0.03) {
    newMinFee = Math.max(0.02, newMinFee - 0.005);
    adjusted = true;
    log("auto_lesson", `THRESHOLD TOO HIGH: no deals → minFee/TVL ${newMinFee.toFixed(3)}`);
  }
  
  config.screening.minFeeActiveTvlRatio = Math.round(newMinFee * 10000) / 10000;
  return { adjusted, newMinFee: config.screening.minFeeActiveTvlRatio, highFeeWinRate, lowFeeWinRate };
}

// 4. MAX POSITIONS
function adjustMaxPositions() {
  if (_performanceHistory.length < 10) return { adjusted: false };
  
  const recentWinRate = _performanceHistory.slice(-10).filter(p => p.exit_pnl_pct > 0).length / 10;
  const avgPnl = _performanceHistory.slice(-10).reduce((s, p) => s + p.exit_pnl_pct, 0) / 10;
  
  let adjusted = false;
  let newMax = config.risk.maxPositions || 2;
  
  // If consistently winning with full positions, increase
  if (recentWinRate > 0.6 && avgPnl > 2 && newMax < 5) {
    newMax += 1;
    adjusted = true;
    log("auto_lesson", `CONSISTENT WINS: winRate=${(recentWinRate*100).toFixed(0)}% avgPnL=${avgPnl.toFixed(1)}% → maxPos ${newMax}`);
  }
  
  // If losing with multiple positions, decrease
  if (recentWinRate < 0.4 && avgPnl < -2 && newMax > 1) {
    newMax -= 1;
    adjusted = true;
    log("auto_lesson", `LOSING STREAK: winRate=${(recentWinRate*100).toFixed(0)}% avgPnL=${avgPnl.toFixed(1)}% → maxPos ${newMax}`);
  }
  
  config.risk.maxPositions = newMax;
  return { adjusted, newMax, recentWinRate, avgPnl };
}

// 5. DEPLOY AMOUNT
function adjustDeployAmount() {
  if (_performanceHistory.length < 10) return { adjusted: false };
  
  const recent = _performanceHistory.slice(-10);
  const winRate = recent.filter(p => p.exit_pnl_pct > 0).length / recent.length;
  const avgPnl = recent.reduce((s, p) => s + p.exit_pnl_pct, 0) / recent.length;
  
  let adjusted = false;
  let newAmount = config.risk.deployAmountSol || 0.7;
  
  // If winning consistently, compound (increase deploy)
  if (winRate > 0.65 && avgPnl > 3 && newAmount < 2) {
    newAmount = Math.round((newAmount + 0.1) * 10) / 10;
    adjusted = true;
    log("auto_lesson", `COMPOUND: winRate=${(winRate*100).toFixed(0)}% avgPnL=${avgPnl.toFixed(1)}% → deploy ${newAmount} SOL`);
  }
  
  // If losing, reduce exposure
  if (winRate < 0.35 && avgPnl < -3 && newAmount > 0.3) {
    newAmount = Math.round((newAmount - 0.1) * 10) / 10;
    adjusted = true;
    log("auto_lesson", `REDUCE RISK: winRate=${(winRate*100).toFixed(0)}% avgPnL=${avgPnl.toFixed(1)}% → deploy ${newAmount} SOL`);
  }
  
  config.risk.deployAmountSol = Math.round(newAmount * 10) / 10;
  return { adjusted, newAmount, winRate, avgPnl };
}

// Save config to file
function saveConfig() {
  try {
    const userConfig = {
      deployAmountSol: config.risk.deployAmountSol,
      maxPositions: config.risk.maxPositions,
      minSolToOpen: config.management.minSolToOpen,
      managementIntervalMin: config.schedule.managementIntervalMin,
      screeningIntervalMin: config.schedule.screeningIntervalMin,
      managementModel: config.llm.managementModel,
      screeningModel: config.llm.screeningModel,
      generalModel: config.llm.generalModel,
      minFeeActiveTvlRatio: config.screening.minFeeActiveTvlRatio,
      minTvl: config.screening.minTvl,
      maxTvl: config.screening.maxTvl,
      minOrganic: config.screening.minOrganic,
      minHolders: config.screening.minHolders,
      minVolatility: config.screening.minVolatility,
      timeframe: config.screening.timeframe,
      category: config.screening.category,
      takeProfitFeePct: config.management.takeProfitFeePct,
      stopLossPct: config.management.emergencyPriceDropPct,
      trailingTakeProfit: config.management.trailingTakeProfit,
      trailingTriggerPct: config.management.trailingTriggerPct,
      trailingDropPct: config.management.trailingDropPct,
      outOfRangeWaitMinutes: config.management.outOfRangeWaitMinutes,
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(userConfig, null, 2));
    log("auto_lesson", `Config saved to ${CONFIG_FILE}`);
  } catch (e) {
    log("auto_lesson_error", `Failed to save config: ${e.message}`);
  }
}

// Get performance summary
export function getLessonPerformance() {
  if (_performanceHistory.length === 0) {
    return { message: "No closed positions yet" };
  }
  
  const byVolatility = {
    low: _performanceHistory.filter(p => p.volatility < 4),
    medium: _performanceHistory.filter(p => p.volatility >= 4 && p.volatility < 6),
    high: _performanceHistory.filter(p => p.volatility >= 6),
  };
  
  const byFeeTvl = {
    low: _performanceHistory.filter(p => p.fee_tvl_ratio < 0.03),
    medium: _performanceHistory.filter(p => p.fee_tvl_ratio >= 0.03 && p.fee_tvl_ratio < 0.06),
    high: _performanceHistory.filter(p => p.fee_tvl_ratio >= 0.06),
  };
  
  return {
    totalClosed: _performanceHistory.length,
    overallWinRate: (_performanceHistory.filter(p => p.exit_pnl_pct > 0).length / _performanceHistory.length * 100).toFixed(1) + '%',
    avgMissedProfit: (_performanceHistory.reduce((s, p) => s + p.missed_profit, 0) / _performanceHistory.length).toFixed(2),
    byVolatility: {
      low: { count: byVolatility.low.length, avgPnl: (byVolatility.low.reduce((s,p)=>s+p.exit_pnl_pct,0) / (byVolatility.low.length||1)).toFixed(2) },
      medium: { count: byVolatility.medium.length, avgPnl: (byVolatility.medium.reduce((s,p)=>s+p.exit_pnl_pct,0) / (byVolatility.medium.length||1)).toFixed(2) },
      high: { count: byVolatility.high.length, avgPnl: (byVolatility.high.reduce((s,p)=>s+p.exit_pnl_pct,0) / (byVolatility.high.length||1)).toFixed(2) },
    },
    currentConfig: {
      trailingTP: `${config.management.trailingTriggerPct}%/${config.management.trailingDropPct}%`,
      minVolatility: config.screening.minVolatility,
      minFeeTvl: config.screening.minFeeActiveTvlRatio,
      maxPositions: config.risk.maxPositions,
      deployAmount: `${config.risk.deployAmountSol} SOL`,
    }
  };
}
