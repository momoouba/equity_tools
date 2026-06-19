const { strTrim } = require('./competitorMatchUtils');
const { requiresMainlandCreditCode, isValidMainlandUscc } = require('./competitorCompanyMatch');
const { resolveFinancingForCompetitor } = require('./competitorFinancingResolve');

function parseIsListedFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return 0;
  const raw =
    candidate.is_listed ??
    candidate.isListed ??
    candidate.validation?.is_listed ??
    candidate.validation?.isListed;
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === '是' || s === 'y') return 1;
  }
  return 0;
}

/**
 * 落库前补齐：信用代码（融资池）、融资全轮次文案、是否上市。
 */
function enrichRelationFieldsBeforePersist(
  { displayName, unifiedCreditCode, candidate },
  financingIndex
) {
  const name = strTrim(displayName);
  let credit = strTrim(unifiedCreditCode);
  let isListed = parseIsListedFromCandidate(candidate);

  const fin = resolveFinancingForCompetitor(financingIndex, {
    displayName: name,
    unifiedCreditCode: credit,
  });

  if (fin.unifiedCreditCode && isValidMainlandUscc(fin.unifiedCreditCode)) {
    credit = fin.unifiedCreditCode;
  } else if (
    requiresMainlandCreditCode(name, credit) &&
    fin.unifiedCreditCode &&
    isValidMainlandUscc(fin.unifiedCreditCode)
  ) {
    credit = fin.unifiedCreditCode;
  }

  return {
    unified_credit_code: credit || null,
    financing_history_text: fin.financingHistoryText || null,
    is_listed: isListed,
  };
}

module.exports = {
  enrichRelationFieldsBeforePersist,
  parseIsListedFromCandidate,
};
