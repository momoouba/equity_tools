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
    body: '开跑前选定当次公式。系统默认：终值用退出 P/E × 末期净利润；现金流用净利润桥（净利润 + 折旧摊销 + ESOP − 资本支出 − 营运资本增加）；敏感性为退出倍数 × 收入 CAGR；单套情景；市场法倍数来自可比个股 POOL。可改成退出 P/S、NOPAT/FCFF、折现率轴、并购+上市双情景，或用申万三级行业中位数替代个股 POOL（下拉选现行东财三级，计算时拉成分并用库内历史中位汇总）。改锚定日、折现率、折扣或方法选项会写入「变更记录」。',
  },
  {
    id: 'comps',
    title: '2. 可比与采集',
    body: '可比公司来自竞品分析最新成功 run、手工代码或 Excel。勾选且「入池」的股票进入 POOL。采集走东方财富境内行情（上交所 / 深交所 / 北交所 / 新三板），拉年报与历史 PE/PS。港股美股不入池。抓取失败时用库内已有财报，并在提示列说明。',
  },
  {
    id: 'fetch',
    title: '3. 系统取数',
    body: '每家可比股：利润表、资产负债表、现金流量表入库；估值倍数按交易日截面。方法配置里可填「市场法锚定日」（未填则自动填入案件创建日，走当天行情），计算时取该日或之前最近一个交易日的 PE/PS。三费、毛利率、DSO/DPO/DIO 由多期财报汇总。标的自身没有上市财报，利润表 / 资产负债 / 现金流需按万元手工录入（或导入）。',
  },
  {
    id: 'relative',
    title: '4. 相对估值（POOL 倍数）',
    body: '每家先取锚定日及以前全部交易日 PE/PS 的历史中位数，再在 POOL 里取中位与样本标准差：低端倍数 = 中位 − σ，高端 = 中位。没有历史中位的公司才回退锚定日截面。相对估值表可填「底稿中位」（如 Wind），有数则进 POOL，空着仍用东财。亏损股的负 PE 中位仍计入 POOL（对齐底稿）；|PE|>500、PS>80 不入统计。单个正倍数低于集合中位/3 或超过 3×中位时，只在算 σ 时截尾，公司仍留在 POOL。北交所转板代码（如 835179→920179）按行情代码取数。',
  },
  {
    id: 'target',
    title: '5. 标的三表',
    body: '利润表按万元。市场法基数优先用锚定日所在年（有营收）：P/S 用营业收入，P/E 用净利润；没有则用最近已实现年。预测年进入 DCF；默认预测 5 年，可只填前两年，其后按收入增速与费用率外推。空白年份会跳过，不会当成 0。DCF 以第一年预测为第 1 期，已实现年不折现。资产负债表核心科目包括货币资金、应收/预付、存货、固资/在建/无形、短贷/长贷、应付/预收；净负债 = 短期借款 + 长期借款 − 货币资金。营运资本占用 = (应收票据+应收账款+预付款项+存货) − (应付票据+应付账款+预收款项)。',
  },
  {
    id: 'market',
    title: '6. 市场法',
    body: '流通权益 = 倍数 × 基数；非流通 = 流通 × (1 − 市场法缺乏流动性折扣)，默认 30%，与并购 DCF 折扣分开。基数优先用锚定日所在年营收/净利润。倍数默认可比 POOL（低端 = −1σ，高端 = 中位）；也可在假设里填底稿低端/中位覆盖 POOL。亏损年仍算 P/E，并告警「利润为负，仅供参考」。行业法开启时，用申万三级 PE/PS 中位数替换个股 POOL，同样按锚定日及以前历史中位。',
  },
  {
    id: 'dcf',
    title: '7. DCF',
    body: '预测期自由现金流按所选口径折现；以第一年预测为第 1 期，已实现年不折现。终值二选一：退出 P/E × 末期净利润，或退出 P/S × 末期收入；工作台只启用对应那一格倍数，改另一格不会动 DCF。折现率默认填汇总 30%；也可填 WACC 分项（无风险利率、ERP、Beta，D/E 与债务成本可空），三项齐了才覆盖汇总折现率，不反算。单套净利润桥：股权价值 = 企业价值 − 净负债，不乘流动性折扣。选「并购 + 上市并排」时，市场法 P/S、P/E 只用市场法折扣；并购 DCF 股权价值再乘 (1−并购流动性折扣)，上市 DCF 不扣。折现率、退出倍数仍可按情景分填。敏感性默认退出 PE 20x～60x、收入 CAGR 以中位为中心 ±5%；结果对比取内圈四角，不是整张表最外的极端点。',
  },
  {
    id: 'result',
    title: '8. 结果对比',
    body: '固定列：市场法 P/S、市场法 P/E、DCF。双情景时 DCF 拆成并购 / 上市两列，P/S、P/E 不拆。每列是低端 / 增量 / 高端的堆叠区间，增量 = 高端 − 低端，不是第三种方法。界面单位亿元。本轮交易估值若有填写，只作对照，不参与计算。',
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
