/**
 * LP Agent overview metrics — cached, shared across the system.
 * Provides real PnL, win rate, fees, and position stats from LP Agent API.
 */

import { log } from "../logger.js";

const LPAGENT_API = "https://api.lpagent.io/open-api/v1";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cache = null;
let _cacheAt = 0;

function getApiKey() {
  return (process.env.LPAGENT_API_KEY || "").split(",")[0].trim() || null;
}

async function getWalletAddress() {
  const bs58 = (await import("bs58")).default;
  const { Keypair } = await import("@solana/web3.js");
  if (!process.env.WALLET_PRIVATE_KEY) return null;
  return Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY)).publicKey.toString();
}

/**
 * Fetch LP overview metrics from LP Agent API.
 * Returns cached result if fresh (< 5 min old).
 *
 * @returns {Object|null} Overview metrics or null on failure
 */
export async function getLpOverview({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cacheAt < CACHE_TTL) {
    return _cache;
  }

  const apiKey = getApiKey();
  if (!apiKey) return _cache || null;

  try {
    const owner = await getWalletAddress();
    if (!owner) return _cache || null;

    const res = await fetch(
      `${LPAGENT_API}/lp-positions/overview?owner=${owner}&protocol=meteora`,
      { headers: { "x-api-key": apiKey } }
    );

    if (!res.ok) {
      log("lp_overview", `API error: ${res.status}`);
      return _cache || null;
    }

    const json = await res.json();
    const d = (json.data || [])[0];
    if (!d) return _cache || null;

    const pnlUnit = (await import("../config.js")).config.management.pnlUnit || "sol";
    const useSol = pnlUnit === "sol";

    _cache = {
      // PnL
      total_pnl: useSol ? round4(d.total_pnl_native?.ALL) : round2(d.total_pnl?.ALL),
      total_pnl_usd: round2(d.total_pnl?.ALL),
      total_pnl_sol: round4(d.total_pnl_native?.ALL),
      pnl_unit: pnlUnit,

      // Fees
      total_fees: useSol ? round4(d.total_fee_native?.ALL) : round2(d.total_fee?.ALL),
      total_fees_usd: round2(d.total_fee?.ALL),
      total_fees_sol: round4(d.total_fee_native?.ALL),

      // Win rate
      win_rate_pct: Math.round((useSol ? d.win_rate_native?.ALL : d.win_rate?.ALL) * 100),
      win_rate_usd_pct: Math.round((d.win_rate?.ALL || 0) * 100),
      win_rate_sol_pct: Math.round((d.win_rate_native?.ALL || 0) * 100),

      // Volume
      total_inflow_usd: round2(d.total_inflow),
      total_inflow_sol: round4(d.total_inflow_native),

      // Positions
      total_positions: d.total_lp || 0,
      closed_positions: d.closed_lp?.ALL || 0,
      open_positions: d.opening_lp || 0,
      total_pools: d.total_pool || 0,
      avg_hold_hours: round2(d.avg_age_hour),

      // ROI
      roi_pct: round2((d.roi || 0) * 100),
      fee_pct_of_capital: round2((d.fee_percent || 0) * 100),

      // Meta
      first_activity: d.first_activity,
      last_activity: d.last_activity,
      updated_at: d.updated_at,
    };

    _cacheAt = Date.now();
    return _cache;
  } catch (e) {
    log("lp_overview", `Fetch failed: ${e.message}`);
    return _cache || null;
  }
}

/**
 * Get a compact one-line summary for prompt injection.
 */
export async function getLpOverviewSummary() {
  const o = await getLpOverview();
  if (!o) return null;
  const pnlLabel = o.pnl_unit === "sol" ? `${o.total_pnl_sol} SOL` : `$${o.total_pnl_usd}`;
  const feesLabel = o.pnl_unit === "sol" ? `${o.total_fees_sol} SOL` : `$${o.total_fees_usd}`;
  return `LP Performance (${o.closed_positions} closed, ${o.open_positions} open): PnL ${pnlLabel} | Fees ${feesLabel} | Win rate ${o.win_rate_pct}% | Avg hold ${o.avg_hold_hours}h | ROI ${o.roi_pct}%`;
}

function round2(n) { return n != null ? Math.round(n * 100) / 100 : 0; }
function round4(n) { return n != null ? Math.round(n * 10000) / 10000 : 0; }
