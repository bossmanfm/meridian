// ─── Pool Memory System (from Yunus-0x) ─────────────────────
// Track performance per pool across multiple deployments

import fs from 'fs';
import { log } from './logger.js';

const MEMORY_FILE = './pool-memory.json';
const MAX_MEMORY_PER_POOL = 10; // Keep last 10 deployments per pool

function load() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

export function recordPoolDeploy(poolAddress, deployData) {
  const memory = load();
  
  if (!memory[poolAddress]) {
    memory[poolAddress] = {
      pool_name: deployData.pool_name,
      base_mint: deployData.base_mint,
      deployments: [],
      stats: {
        totalDeployments: 0,
        totalPnlUsd: 0,
        totalPnlPct: 0,
        winCount: 0,
        lossCount: 0,
        avgRangeEfficiency: 0,
        avgMinutesHeld: 0,
      }
    };
  }
  
  const pool = memory[poolAddress];
  pool.deployments.push({
    deployed_at: deployData.deployed_at,
    closed_at: deployData.closed_at,
    pnl_pct: deployData.pnl_pct,
    pnl_usd: deployData.pnl_usd,
    range_efficiency: deployData.range_efficiency,
    minutes_held: deployData.minutes_held,
    close_reason: deployData.close_reason,
    strategy: deployData.strategy,
    volatility: deployData.volatility,
  });
  
  // Keep only last N deployments
  if (pool.deployments.length > MAX_MEMORY_PER_POOL) {
    pool.deployments.shift();
  }
  
  // Recalculate stats
  pool.stats.totalDeployments = pool.deployments.length;
  pool.stats.totalPnlUsd = pool.deployments.reduce((s, d) => s + d.pnl_usd, 0);
  pool.stats.totalPnlPct = pool.deployments.reduce((s, d) => s + d.pnl_pct, 0);
  pool.stats.winCount = pool.deployments.filter(d => d.pnl_pct > 0).length;
  pool.stats.lossCount = pool.deployments.filter(d => d.pnl_pct < 0).length;
  pool.stats.avgRangeEfficiency = pool.stats.totalDeployments > 0 
    ? pool.deployments.reduce((s, d) => s + d.range_efficiency, 0) / pool.stats.totalDeployments 
    : 0;
  pool.stats.avgMinutesHeld = pool.stats.totalDeployments > 0
    ? pool.deployments.reduce((s, d) => s + d.minutes_held, 0) / pool.stats.totalDeployments
    : 0;
  
  save(memory);
  
  const winRate = pool.stats.totalDeployments > 0 
    ? (pool.stats.winCount / pool.stats.totalDeployments * 100).toFixed(0) 
    : 0;
  
  log("pool_memory", `${deployData.pool_name}: ${pool.stats.totalDeployments} deployments, ${winRate}% win rate, avg PnL ${(pool.stats.totalPnlPct / pool.stats.totalDeployments).toFixed(1)}%`);
  
  return pool.stats;
}

export function getPoolMemory(poolAddress) {
  const memory = load();
  return memory[poolAddress] || null;
}

export function getAllPoolMemory() {
  return load();
}

export function shouldSkipPool(poolAddress, config) {
  const memory = getPoolMemory(poolAddress);
  if (!memory || memory.stats.totalDeployments < 3) {
    return false; // Not enough data
  }
  
  const winRate = memory.stats.winCount / memory.stats.totalDeployments;
  const avgPnl = memory.stats.totalPnlPct / memory.stats.totalDeployments;
  
  // Skip if consistently losing
  if (winRate < 0.3 && avgPnl < -5) {
    log("pool_memory", `SKIP ${memory.pool_name}: winRate=${(winRate*100).toFixed(0)}% avgPnL=${avgPnl.toFixed(1)}%`);
    return true;
  }
  
  return false;
}

export function getPoolLesson(poolAddress) {
  const memory = getPoolMemory(poolAddress);
  if (!memory || memory.stats.totalDeployments < 2) {
    return null;
  }
  
  const winRate = memory.stats.winCount / memory.stats.totalDeployments;
  const avgPnl = memory.stats.totalPnlPct / memory.stats.totalDeployments;
  const avgEfficiency = memory.stats.avgRangeEfficiency;
  
  let lesson = "";
  let outcome = "neutral";
  
  if (winRate >= 0.6 && avgPnl >= 3) {
    lesson = `PREFER: ${memory.pool_name} — ${(winRate*100).toFixed(0)}% win rate, ${avgPnl.toFixed(1)}% avg PnL, ${avgEfficiency.toFixed(0)}% range efficiency over ${memory.stats.totalDeployments} deployments`;
    outcome = "good";
  } else if (winRate <= 0.4 && avgPnl <= -3) {
    lesson = `AVOID: ${memory.pool_name} — ${(winRate*100).toFixed(0)}% win rate, ${avgPnl.toFixed(1)}% avg PnL over ${memory.stats.totalDeployments} deployments`;
    outcome = "bad";
  }
  
  if (!lesson) return null;
  
  return {
    pool: poolAddress,
    pool_name: memory.pool_name,
    lesson,
    outcome,
    stats: memory.stats,
  };
}
