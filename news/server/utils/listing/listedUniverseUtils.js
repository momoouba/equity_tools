'use strict';

const DOMESTIC_EXCHANGES = new Set(['上交所', '深交所', '北交所']);

/** 业务口径：境内沪深北当前上市家数（与 listedFinancingJoin 一致） */
const MARKET_LISTED_BASELINE = {
  上交所: 2318,
  深交所: 2897,
  北交所: 317,
};

const UNIVERSE_PLACEHOLDER_ISSUE_DATE = '1900-01-01';

function exchangeFromStockCode(stockCode) {
  let code = String(stockCode || '').trim();
  if (/^\d+$/.test(code) && code.length < 6) code = code.padStart(6, '0');
  if (code.startsWith('60') || code.startsWith('68')) return '上交所';
  if (code.startsWith('00') || code.startsWith('30')) return '深交所';
  if (code.startsWith('8') || code.startsWith('92') || code.startsWith('43') || code.startsWith('4')) {
    return '北交所';
  }
  return '';
}

function isDomesticExchange(exchange) {
  return DOMESTIC_EXCHANGES.has(String(exchange || '').trim());
}

function isUniversePlaceholderIssueDate(issueDate) {
  return String(issueDate || '').slice(0, 10) === UNIVERSE_PLACEHOLDER_ISSUE_DATE;
}

module.exports = {
  DOMESTIC_EXCHANGES,
  MARKET_LISTED_BASELINE,
  UNIVERSE_PLACEHOLDER_ISSUE_DATE,
  exchangeFromStockCode,
  isDomesticExchange,
  isUniversePlaceholderIssueDate,
};
