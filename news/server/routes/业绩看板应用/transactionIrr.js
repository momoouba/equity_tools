/**
 * 业绩看板 - 基金 Gross IRR / Net IRR 计算
 * 在 b_transaction_indicator 写入完成后，基于 b_transaction 同版本数据计算并回写 girr、nirr。
 */

/**
 * 根据现金流序列计算年化 IRR（牛顿法）
 * - 在计算前，会按交易时间升序重新排序现金流
 * @param {number[]} amounts - 现金流金额（正=流入，负=流出）
 * @param {Date[]} dates - 对应交易日期
 * @returns {number|null} 年化收益率（小数形式，如 0.12 表示 12%），无法计算时返回 null
 */
function computeIRR(amounts, dates) {
  if (!amounts.length || !dates.length || amounts.length !== dates.length) return null;

  // 按日期升序重新排序现金流，确保时间序列正确
  const pairs = amounts.map((amt, i) => ({
    amount: Number(amt),
    time: new Date(dates[i]).getTime(),
  })).filter(p => !Number.isNaN(p.amount) && !Number.isNaN(p.time));

  if (pairs.length < 2) return null;

  pairs.sort((a, b) => a.time - b.time);

  // 若所有现金流同号，IRR 数学上无解，直接返回 null
  const hasPositive = pairs.some(p => p.amount > 0);
  const hasNegative = pairs.some(p => p.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const t0 = pairs[0].time;
  const oneYearMs = 365.25 * 24 * 3600 * 1000;
  const periods = pairs.map((p) => (p.time - t0) / oneYearMs);

  function npv(rate) {
    return pairs.reduce((sum, p, i) => sum + p.amount / Math.pow(1 + rate, periods[i]), 0);
  }

  function npvDerivative(rate) {
    return pairs.reduce(
      (sum, p, i) => sum - (p.amount * periods[i]) / Math.pow(1 + rate, periods[i] + 1),
      0
    );
  }

  // 先构造一个包含根的区间，再用牛顿法 + 二分的混合方式求解，提升稳定性
  let low = -0.9999;
  let high = 10;
  let npvLow = npv(low);
  let npvHigh = npv(high);

  // 尝试扩大上界，确保存在符号变化；否则认为无解
  let expandCount = 0;
  while (npvLow * npvHigh > 0 && expandCount < 5) {
    high *= 2;
    npvHigh = npv(high);
    expandCount += 1;
  }
  if (npvLow * npvHigh > 0) {
    return null;
  }

  let r = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    const n = npv(r);
    if (Math.abs(n) < 1e-8) return r;
    const dn = npvDerivative(r);

    let next;
    if (Math.abs(dn) < 1e-10) {
      // 导数太小，用二分法而不是牛顿
      next = (low + high) / 2;
    } else {
      next = r - n / dn;
      // 若牛顿步跳出区间，则退回到区间中点
      if (next <= low || next >= high) {
        next = (low + high) / 2;
      }
    }

    const npvNext = npv(next);
    if (Math.abs(npvNext) < 1e-8) return next;

    // 根据符号更新区间
    if (npvLow * npvNext < 0) {
      high = next;
      npvHigh = npvNext;
    } else {
      low = next;
      npvLow = npvNext;
    }

    r = next;
  }

  // 迭代结束，返回区间中点作为近似解
  return (low + high) / 2;
}

/**
 * 从 b_transaction 行构建 Net IRR 现金流（投资人视角）
 * - 流出：lp is not null and transaction_type = '实缴'
 * - 流入：lp is not null and transaction_type = '分配'
 * - 终值：lp is null and sub_fund is null and company is null and transaction_type = '未实现价值'
 */
function buildNetCashFlows(rows) {
  const amounts = [];
  const dates = [];
  for (const r of rows) {
    const lp = r.lp != null && String(r.lp).trim() !== '';
    const subFund = r.sub_fund != null && String(r.sub_fund).trim() !== '';
    const company = r.company != null && String(r.company).trim() !== '';
    const type = (r.transaction_type && String(r.transaction_type).trim()) || '';
    const amount = Number(r.transaction_amount);
    const date = r.transaction_date;
    if (date == null) continue;
    if (lp && type === '实缴') {
      amounts.push(-Math.abs(amount));
      dates.push(date);
    } else if (lp && type === '分配') {
      amounts.push(Math.abs(amount));
      dates.push(date);
    } else if (!lp && !subFund && !company && type === '未实现价值') {
      amounts.push(Math.abs(amount));
      dates.push(date);
    }
  }
  return { amounts, dates };
}

/**
 * 从 b_transaction 行构建 Gross IRR 现金流（基金视角）
 * - 现金流流出（负数）：lp is not null AND transaction_type IN ('实缴','出资')
 * - 现金流流入（正数）：lp is not null AND transaction_type IN ('分配','转让','分红','退出')
 * - 终值（正数）：lp is null AND (sub_fund is not null OR company is not null) AND transaction_type = '未实现价值'
 */
const GROSS_OUT_TYPES = ['实缴', '出资'];
const GROSS_IN_TYPES = ['分配', '转让', '分红', '退出'];

function buildGrossCashFlows(rows) {
  const amounts = [];
  const dates = [];
  for (const r of rows) {
    const lp = r.lp != null && String(r.lp).trim() !== '';
    const subFund = r.sub_fund != null && String(r.sub_fund).trim() !== '';
    const company = r.company != null && String(r.company).trim() !== '';
    const type = (r.transaction_type && String(r.transaction_type).trim()) || '';
    const amount = Number(r.transaction_amount);
    const date = r.transaction_date;
    if (date == null) continue;
    // 基金视角（需求修正）：仅当 lp 为空时参与 GROSS IRR
    // 流出：lp IS NULL AND transaction_type IN ('实缴','出资')
    if (!lp && GROSS_OUT_TYPES.includes(type)) {
      amounts.push(-Math.abs(amount));
      dates.push(date);
    // 流入：lp IS NULL AND transaction_type IN ('分配','转让','分红','退出')
    } else if (!lp && GROSS_IN_TYPES.includes(type)) {
      amounts.push(Math.abs(amount));
      dates.push(date);
    // 终值：lp IS NULL AND (sub_fund IS NOT NULL OR company IS NOT NULL) AND transaction_type = '未实现价值'
    } else if ( !lp && (subFund || company) && type === '未实现价值') {
      amounts.push(Math.abs(amount));
      dates.push(date);
    }
  }
  return { amounts, dates };
}

/**
 * 对指定版本：从 b_transaction_indicator 取基金列表，从 b_transaction 取该版本该基金的流水，
 * 分别计算 Net IRR / Gross IRR 并更新回 b_transaction_indicator 的 nirr、girr。
 * @param {object} connection - 数据库连接（与版本创建同一事务）
 * @param {string} version - 版本号
 */
async function computeAndUpdateTransactionIrr(connection, version) {
  const [fundRows] = await connection.query(
    `SELECT DISTINCT fund FROM b_transaction_indicator
     WHERE version = ? AND F_DeleteMark = 0 AND fund IS NOT NULL AND TRIM(IFNULL(fund,'')) <> ''`,
    [version]
  );
  if (!fundRows || fundRows.length === 0) return;

  for (const { fund } of fundRows) {
    const [txRows] = await connection.query(
      `SELECT lp, sub_fund, company, transaction_type, transaction_amount, transaction_date
       FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0 AND fund = ?
       ORDER BY transaction_date ASC`,
      [version, fund]
    );
    if (!txRows || txRows.length === 0) continue;

    const netCf = buildNetCashFlows(txRows);
    const grossCf = buildGrossCashFlows(txRows);

    let nirr = null;
    let girr = null;
    if (netCf.amounts.length >= 2) {
      const rate = computeIRR(netCf.amounts, netCf.dates);
      nirr = rate != null ? rate : null;
    }
    if (grossCf.amounts.length >= 2) {
      const rate = computeIRR(grossCf.amounts, grossCf.dates);
      girr = rate != null ? rate : null;
    }

    await connection.execute(
      `UPDATE b_transaction_indicator
       SET girr = ?, nirr = ?
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [girr, nirr, version, fund]
    );
  }
}

module.exports = {
  computeIRR,
  buildNetCashFlows,
  buildGrossCashFlows,
  computeAndUpdateTransactionIrr
};
