/**
 * 底层项目上市进展：列表 / 导出 / 邮件共用排序。
 * 1. 更新日期（日历日）倒序
 * 2. 归属基金 → 归属子基金 → 项目简称 升序分组
 * 3. 同组内再按完整更新时间倒序
 */
const IPP_ORDER_BY_IPP = `DATE(ipp.F_UpdateTime) DESC, TRIM(ipp.fund) ASC, IFNULL(TRIM(ipp.sub), '') ASC, TRIM(ipp.project_name) ASC, ipp.F_UpdateTime DESC`;

const IPP_ORDER_BY_PLAIN = `DATE(F_UpdateTime) DESC, TRIM(fund) ASC, IFNULL(TRIM(sub), '') ASC, TRIM(project_name) ASC, F_UpdateTime DESC`;

module.exports = { IPP_ORDER_BY_IPP, IPP_ORDER_BY_PLAIN };
