import React from 'react'
import { Typography } from '@arco-design/web-react'

const FLOW = [
  { id: 'method', title: '方法配置' },
  { id: 'comps', title: '可比与采集' },
  { id: 'fetch', title: '系统取数' },
  { id: 'relative', title: '相对估值' },
  { id: 'target', title: '标的三表' },
  { id: 'market', title: '市场法' },
  { id: 'dcf', title: 'DCF' },
  { id: 'result', title: '结果对比' },
]

const STEPS = [
  {
    id: 'method',
    title: '1. 方法配置',
    body: '开跑前选定估值锚定日，只能是 3 月 31 日、6 月 30 日、9 月 30 日或 12 月 31 日，新建留空并标必填。市场法倍数仍来自可比个股 POOL 或申万三级。DCF 现金流固定为税后经营利润 + 折旧摊销 + ESOP − 资本开支 − ΔNWC。退出 P/E 和退出 P/S 各算一笔终值，结果对比的 DCF 区间取这两笔股权价值。明细表按方法配置里选定的那一套终值展开。单套情景里只有选了 NOPAT 才乘 DCF 流动性折扣；双情景只有并购乘。改锚定日、折现率、折扣或方法选项会写入「变更记录」。',
  },
  {
    id: 'comps',
    title: '2. 可比与采集',
    body: '可比公司先由 AI 提名境内上市同业并给出业务理由，再对照上市主档核实代码；同时按行业/赛道规则召回。也可从竞品分析最新成功 run、手工代码或 Excel 导入。名单可编辑删除；预览可见匹配理由。勾选且「入池」的股票进入 POOL。可比程度只是标记，不改变计算结果，也不自动改入池。采集走东方财富境内行情（上交所 / 深交所 / 北交所 / 新三板），拉年报与历史 PE/PS。港股美股不入池。抓取失败时用库内已有财报，并在提示列说明。',
  },
  {
    id: 'fetch',
    title: '3. 系统取数',
    body: '每家可比股：利润表、资产负债表、现金流量表入库；估值倍数按交易日截面。估值锚定日未填或不是季末、年末报表日时，市场法和 DCF 都不计算，也不会改成今天。三费、毛利率按公司、按年展示。DCF 用的周转天数是已入池公司最近一个完整会计年度年报的截面中位数。标的利润表按比例填写，资产负债表按元填写锚定日实际列。',
  },
  {
    id: 'relative',
    title: '4. 相对估值（POOL 倍数）',
    body: '每家先取锚定日及以前全部交易日 PE/PS 的历史中位数。单家进入 POOL 的取用值：有底稿中位用底稿，否则用历史中位，再否则用锚定截面。可比强度只作标记，不参与计算。表末「取用结果」一行给出这些取用值的中位数（高端倍数）和中位数 − σ（低端倍数）。亏损股的负 PE 中位仍计入；|PE|>500、PS>80 不入统计。单个正倍数低于集合中位/3 或超过 3×中位时，只在算 σ 时截尾，公司仍留在 POOL。北交所转板代码（如 835179→920179）按行情代码取数。',
  },
  {
    id: 'target',
    title: '5. 标的三表',
    body: '利润表填写收入增速和各项占当年营业收入的比例，空白年份沿用最近一次已填数。绝对值大于 10000 的格子按该年金额。累计营业收入是锚定日当期的数，不进当年年底预测。锚定日不是 12 月 31 日时，当年年底金额在预测利润表填写，不按当期累计年化；收入以后各年 = 上一年 ×（1+增速）。12 月 31 日时，第一年 = 当年全年实际 ×（1+增速）。现金流量表填写锚定日当期累计折旧摊销和资本开支，供当年期间现金流减去已发生部分。市场法营业收入和净利润单独填，不进 DCF。资产负债表只填锚定日实际列，资产须等于负债加所有者权益。净负债 = 短期借款 + 一年内到期的非流动负债 + 长期借款 + 租赁负债 − 货币资金。锚定日营运资本 =（应收账款含票据 − 合同负债）+ 存货 −（应付账款含票据 − 预付款项）。',
  },
  {
    id: 'market',
    title: '6. 市场法',
    body: '流通权益 = 倍数 × 基数；非流通 = 流通 × (1 − 市场法缺乏流动性折扣)，默认 30%，与并购 DCF 折扣分开。基数优先用锚定日所在年营收/净利润。P/S 用可比公司市销率乘营业收入，P/E 用可比公司市盈率乘净利润，两套倍数不同，也不使用 DCF 的退出 P/E、退出 P/S。每套只分低端和高端：低端 = POOL 中位数 − σ，高端 = POOL 中位数。计算后填进市场法倍数格；改数字会锁定覆盖 POOL，点「跟随 POOL」后再点「开始采集/计算/保存」即恢复。亏损年仍算 P/E，并告警「利润为负，仅供参考」。行业法开启时，用申万三级 PE/PS 中位数替换个股 POOL，同样按锚定日及以前历史中位。',
  },
  {
    id: 'dcf',
    title: '7. DCF',
    body: '自由现金流 = 期间税后经营利润 + 期间折旧摊销 + 期间 ESOP − 期间资本开支 − ΔNWC。锚定年且不是 12 月时，期间数 = 年底全年 − 锚定日累计；ESOP 没有累计数，按剩余月计入。以后各年用全年数。折现期按锚定日到该年 12 月 31 日的月数除以 12。退出 P/E 和退出 P/S 都要填。终值分别是退出 P/E × 末期税后经营利润，以及退出 P/S × 末期全年营业收入；各自加上锚定日净负债，再按最后一年的同一期数折现。结果对比的 DCF 低端和高端就是这两笔股权价值。明细里的终值按方法配置选定的那一套。折现率默认填汇总 30%；也可填 WACC 分项（无风险利率、ERP、Beta，D/E 与债务成本可空），三项齐了才覆盖汇总折现率，不反算。单套选「净利润桥」时股权价值不乘 DCF 流动性折扣，选 NOPAT 才乘。选「并购 + 上市并排」时，市场法只用市场法折扣；并购 DCF 再乘 (1−并购流动性折扣)，上市 DCF 不扣。折现率和两套退出倍数都可按情景分填。',
  },
  {
    id: 'result',
    title: '8. 结果对比',
    body: '固定列：市场法 P/S、市场法 P/E、DCF。市场法两列用可比公司自己的市销率和市盈率。DCF 列的低端和高端是退出 P/E 与退出 P/S 两套终值的股权价值。双情景时 DCF 拆成并购 / 上市两列，每列仍是该情景的两套退出终值，P/S、P/E 不拆。增量 = 高端 − 低端，不是第三种方法。界面单位亿元。本轮交易估值（投前）作对照虚线，并作为退出 MOC、退出 IRR 的分母，不进入股权价值。右侧敏感性可选折现率、营收 CAGR、研发费用 CAGR 对退出倍数，或营收 CAGR 对研发费用 CAGR。后一种退出倍数停在当前输入，营收 CAGR 和研发费用 CAGR 各用自己的步长。P/E、P/S 和当前这组用到的步长可改，改完要点「开始采集/计算/保存」。',
  },
]

export default function ValuationMethodGuide() {
  return (
    <div className="valuation-method-guide">
      <Typography.Title heading={6} className="valuation-ratio-col-title">估值说明</Typography.Title>
      <div className="valuation-method-guide-body">
        <aside className="valuation-method-flow" aria-label="估值流程">
          {FLOW.map((item, i) => (
            <React.Fragment key={item.id}>
              {i > 0 ? <div className="valuation-method-flow-arrow" aria-hidden>↓</div> : null}
              <div className="valuation-method-flow-node">
                <span className="valuation-method-flow-idx">{i + 1}</span>
                <span>{item.title}</span>
              </div>
            </React.Fragment>
          ))}
        </aside>
        <ol className="valuation-method-steps">
          {STEPS.map((s) => (
            <li key={s.id} className="valuation-method-step">
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
