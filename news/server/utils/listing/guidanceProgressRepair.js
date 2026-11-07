/** status 整段为日期（列错位把备案时间读进审核状态） */
function statusLooksLikeDate(status) {
  const t = String(status || '').trim();
  if (!t) return false;
  if (!/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(t)) return false;
  const rest = t.replace(new RegExp('[\\d\\s\\-/.年月日:]', 'g'), '');
  return rest === '';
}

/**
 * 列左偏时：status=日期、register_address=原状态、board=派出机构。
 * 不丢弃：status→辅导备案；派出机构取含「局」的字段；board→辅导备案报告。
 */
function repairGuidanceShiftedFields(status, registerAddress, board) {
  const st = String(status || '').trim();
  const addr = String(registerAddress || '').trim();
  const bd = String(board || '').trim();
  if (!statusLooksLikeDate(st)) {
    return {
      status: st || '辅导备案',
      registerAddress: addr,
      board: bd,
    };
  }
  const office = [addr, bd, st].find((c) => c && c.includes('局')) || '';
  return {
    status: '辅导备案',
    registerAddress: office,
    board: '辅导备案报告',
  };
}

module.exports = {
  statusLooksLikeDate,
  repairGuidanceShiftedFields,
};
