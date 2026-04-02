// ─── OKX OnchainOS Integration ─────────────────────────────────
// FREE API for smart money signals and token risk scoring
// No API key required

import { log } from "./logger.js";

const OKX_BASE = "https://www.okx.com/api/v5";

// Cache to avoid repeated calls
const _cache = new Map();
const CACHE_TTL = 5 * 60_000; // 5 minutes

/**
 * Get token risk score and smart money signals from OKX OnchainOS
 * @param {string} mint - Token mint address
 * @returns {Promise<Object>} Risk assessment and smart money data
 */
export async function getTokenRisk(mint) {
  const cacheKey = `risk:${mint}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.data;
  }

  try {
    log("okx", `Fetching risk score for ${mint.slice(0, 8)}...`);
    
    // OKX Web3 API - Token Security
    const url = `${OKX_BASE}/defi/token-security?chainId=101&tokenAddress=${mint}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" }
    });
    
    if (!res.ok) {
      log("okx_warn", `OKX risk API ${res.status}`);
      return { error: `OKX API ${res.status}` };
    }

    const data = await res.json();
    
    // Parse OKX response
    const security = data.data?.[0] || {};
    
    const result = {
      risk_score: parseInt(security.riskLevel || "50"),  // 0-100, lower = safer
      rug_probability: security.rugPullRisk || "medium",  // low/medium/high
      is_honeypot: security.isHoneypot === "true",
      dev_wallet_sold: parseFloat(scurity.devSellRatio || "0"),
      insider_wallets: parseInt(security.insiderCount || "0"),
      smart_wallet_count: parseInt(security.smartMoneyCount || "0"),
      holder_concentration: parseFloat(security.topHolderRatio || "0"),
      liquidity_locked: security.lockedLiquidity === "true",
      mint_authority: security.mintAuthority === "disabled",
      freeze_authority: security.freezeAuthority === "disabled",
    };

    _cache.set(cacheKey, { data: result, at: Date.now() });
    log("okx", `Risk score: ${result.risk_score}/100 for ${mint.slice(0, 8)}`);
    return result;
  } catch (e) {
    log("okx_error", `getTokenRisk failed: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Get smart money flow for a pool
 * @param {string} pool - Pool address
 * @param {string} baseMint - Base token mint
 * @returns {Promise<Object>} Smart money participation data
 */
export async function getSmartMoneyFlow(pool, baseMint) {
  const cacheKey = `smart:${pool}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.data;
  }

  try {
    log("okx", `Fetching smart money flow for ${pool.slice(0, 8)}...`);
    
    // OKX Web3 API - Smart Money Tracking
    const url = `${OKX_BASE}/defi/smart-money/positions?chainId=101&poolAddress=${pool}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" }
    });
    
    if (!res.ok) {
      log("okx_warn", `OKX smart money API ${res.status}`);
      return { error: `OKX API ${res.status}` };
    }

    const data = await res.json();
    
    const positions = data.data || [];
    const smartWallets = [];
    let totalSmartPnl = 0;
    
    for (const pos of positions) {
      if (pos.pnl30d && pos.pnl30d > 0) {
        smartWallets.push({
          address: pos.walletAddress,
          pnl_30d: parseFloat(pos.pnl30d),
          win_rate: parseFloat(pos.winRate || "0"),
          position_size: parseFloat(pos.positionSize || "0")
        });
        totalSmartPnl += parseFloat(pos.pnl30d);
      }
    }
    
    const result = {
      smart_wallet_count: smartWallets.length,
      smart_wallet_pct: positions.length > 0 ? (smartWallets.length / positions.length * 100) : 0,
      avg_smart_pnl_30d: smartWallets.length > 0 ? (totalSmartPnl / smartWallets.length) : 0,
      smart_wallets: smartWallets.slice(0, 5),  // Top 5
      smart_money_flow: smartWallets.length > 0 ? "inflow" : "neutral"
    };

    _cache.set(cacheKey, { data: result, at: Date.now() });
    log("okx", `Smart money: ${result.smart_wallet_count} wallets for ${pool.slice(0, 8)}`);
    return result;
  } catch (e) {
    log("okx_error", `getSmartMoneyFlow failed: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Check for wash trading in pool volume
 * @param {string} pool - Pool address
 * @returns {Promise<Object>} Wash trade assessment
 */
export async function checkWashTrading(pool) {
  const cacheKey = `wash:${pool}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.data;
  }

  try {
    log("okx", `Checking wash trade for ${pool.slice(0, 8)}...`);
    
    // OKX Web3 API - Volume Analysis
    const url = `${OKX_BASE}/defi/pool-volume-analysis?chainId=101&poolAddress=${pool}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" }
    });
    
    if (!res.ok) {
      log("okx_warn", `OKX volume API ${res.status}`);
      return { error: `OKX API ${res.status}` };
    }

    const data = await res.json();
    const analysis = data.data || {};
    
    const result = {
      real_volume_pct: parseFloat(analysis.realVolumeRatio || "100"),
      wash_trade_detected: analysis.washTradeDetected === "true",
      suspicious_wallets: parseInt(analysis.suspiciousWalletCount || "0"),
      volume_quality: analysis.volumeQuality || "unknown"  // high/medium/low
    };

    _cache.set(cacheKey, { data: result, at: Date.now() });
    log("okx", `Wash trade check: ${result.wash_trade_detected ? "DETECTED" : "CLEAN"} for ${pool.slice(0, 8)}`);
    return result;
  } catch (e) {
    log("okx_error", `checkWashTrading failed: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Full OKX enrichment for screening
 * @param {Object} candidate - Pool candidate from screening
 * @returns {Promise<Object>} Enriched candidate with OKX data
 */
export async function enrichWithOKX(candidate) {
  const { pool, base_mint } = candidate;
  
  const [risk, smart, wash] = await Promise.all([
    getTokenRisk(base_mint).catch(() => ({})),
    getSmartMoneyFlow(pool, base_mint).catch(() => ({})),
    checkWashTrading(pool).catch(() => ({}))
  ]);
  
  return {
    ...candidate,
    okx_risk_score: risk.risk_score ?? 50,
    okx_rug_probability: risk.rug_probability ?? "medium",
    okx_is_honeypot: risk.is_honeypot ?? false,
    okx_smart_wallet_count: smart.smart_wallet_count ?? 0,
    okx_smart_wallet_pct: smart.smart_wallet_pct ?? 0,
    okx_smart_money_flow: smart.smart_money_flow ?? "neutral",
    okx_wash_trade_detected: wash.wash_trade_detected ?? false,
    okx_real_volume_pct: wash.real_volume_pct ?? 100,
    okx_volume_quality: wash.volume_quality ?? "medium"
  };
}
