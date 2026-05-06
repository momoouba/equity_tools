/**
 * 项目挖掘：开箱赛道树种子（人工智能 / 生物医药 / 半导体）
 * 仅在 sourcing_track 尚无未删除记录时执行，不覆盖用户已有配置。
 *
 * 匹配字段与 Excel 导入一致：精确行业（来源/标准一级二级）+ 关键词；优先级越大越先匹配。
 */

/** @typedef {{ name: string, sort: number, m1?: string, m2?: string, kw?: string, pri: number }} Lv3Leaf */
/** @typedef {{ name: string, sort_order: number, lv3: Lv3Leaf[] }} Lv2Node */
/** @typedef {{ name: string, sort_order: number, lv2: Lv2Node[] }} Lv1Node */
/** @typedef {{ name: string, sort_order: number, lv1: Lv1Node[] }} TrackNode */

/** @type {TrackNode[]} */
const DEFAULT_TRACK_TREE = [
  {
    name: '人工智能',
    sort_order: 10,
    lv1: [
      {
        name: '基础层与模型',
        sort_order: 10,
        lv2: [
          {
            name: '大模型与基础软件',
            sort_order: 10,
            lv3: [
              {
                name: '大模型与AIGC底座',
                sort: 10,
                m1: '人工智能',
                m2: '人工智能基础技术',
                kw: '大模型,LLM,AIGC,生成式AI,多模态',
                pri: 100,
              },
              {
                name: '机器学习与MLOps',
                sort: 20,
                m1: '人工智能',
                m2: '',
                kw: '机器学习,MLOps,深度学习框架,训练推理',
                pri: 90,
              },
            ],
          },
          {
            name: '感知与认知',
            sort_order: 20,
            lv3: [
              {
                name: '计算机视觉',
                sort: 10,
                m1: '人工智能',
                m2: '',
                kw: '计算机视觉,CV,图像识别,视觉检测',
                pri: 88,
              },
              {
                name: '智能语音与NLP',
                sort: 20,
                m1: '人工智能',
                m2: '',
                kw: '自然语言处理,NLP,语音识别,语音合成,对话系统',
                pri: 88,
              },
            ],
          },
        ],
      },
      {
        name: '具身智能与机器人',
        sort_order: 20,
        lv2: [
          {
            name: '工业机器人与服务机器人',
            sort_order: 10,
            lv3: [
              {
                name: '协作与人形机器人',
                sort: 10,
                m1: '先进制造',
                m2: '机器人',
                kw: '协作机器人,人形机器人,AMR,移动机器人',
                pri: 95,
              },
              {
                name: '机器人感知与运控',
                sort: 20,
                m1: '',
                m2: '',
                kw: '运动控制,伺服,减速器,具身智能,灵巧手',
                pri: 82,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: '生物医药',
    sort_order: 20,
    lv1: [
      {
        name: '创新药与疗法',
        sort_order: 10,
        lv2: [
          {
            name: '小分子与靶向药',
            sort_order: 10,
            lv3: [
              {
                name: '抗肿瘤与靶向治疗',
                sort: 10,
                m1: '医疗健康',
                m2: '创新药',
                kw: '抗肿瘤,靶向药,小分子,激酶抑制剂',
                pri: 100,
              },
            ],
          },
          {
            name: '生物药与疫苗',
            sort_order: 20,
            lv3: [
              {
                name: '抗体与疫苗',
                sort: 10,
                m1: '医疗健康',
                m2: '',
                kw: '抗体药,单抗,双抗,ADC,疫苗,mRNA,基因治疗,细胞治疗',
                pri: 96,
              },
            ],
          },
        ],
      },
      {
        name: 'CXO与研发生产服务',
        sort_order: 20,
        lv2: [
          {
            name: 'CDMO与CRO',
            sort_order: 10,
            lv3: [
              {
                name: 'CDMO',
                sort: 10,
                m1: '',
                m2: '',
                kw: 'CDMO,合同研发生产,原料药中间体',
                pri: 92,
              },
              {
                name: '临床前与临床CRO',
                sort: 20,
                m1: '',
                m2: '',
                kw: 'CRO,临床前,临床试验,SMO,药理毒理',
                pri: 90,
              },
            ],
          },
        ],
      },
      {
        name: '医疗器械与诊断',
        sort_order: 30,
        lv2: [
          {
            name: '高值耗材与设备',
            sort_order: 10,
            lv3: [
              {
                name: '医疗器械与影像',
                sort: 10,
                m1: '医疗健康',
                m2: '医疗器械',
                kw: '医疗器械,高值耗材,医学影像,内窥镜',
                pri: 93,
              },
              {
                name: 'IVD与分子诊断',
                sort: 20,
                m1: '',
                m2: '',
                kw: 'IVD,体外诊断,基因检测,伴随诊断,POCT',
                pri: 89,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: '半导体',
    sort_order: 30,
    lv1: [
      {
        name: '设计与EDA',
        sort_order: 10,
        lv2: [
          {
            name: '芯片设计与IP',
            sort_order: 10,
            lv3: [
              {
                name: '数字与模拟芯片设计',
                sort: 10,
                m1: '先进制造',
                m2: '半导体',
                kw: '芯片设计,SoC,MCU,射频芯片,模拟芯片,功率半导体',
                pri: 100,
              },
              {
                name: 'EDA与IP核',
                sort: 20,
                m1: '',
                m2: '',
                kw: 'EDA,IP核,流片服务,芯片验证',
                pri: 86,
              },
            ],
          },
        ],
      },
      {
        name: '制造与封测',
        sort_order: 20,
        lv2: [
          {
            name: '晶圆制造与材料',
            sort_order: 10,
            lv3: [
              {
                name: '晶圆厂与制造设备',
                sort: 10,
                m1: '',
                m2: '',
                kw: '晶圆制造,晶圆厂,光刻,刻蚀,薄膜沉积,CVD,PVD',
                pri: 96,
              },
              {
                name: '半导体材料',
                sort: 20,
                m1: '',
                m2: '',
                kw: '硅片,光刻胶,靶材,CMP,特种气体,封装材料',
                pri: 92,
              },
            ],
          },
          {
            name: '封装测试',
            sort_order: 20,
            lv3: [
              {
                name: '先进封装与测试',
                sort: 10,
                m1: '',
                m2: '',
                kw: '封装测试,先进封装,Chiplet,TSV,OSAT,测试探针',
                pri: 94,
              },
            ],
          },
        ],
      },
      {
        name: '设备与零部件',
        sort_order: 30,
        lv2: [
          {
            name: '前道与量检测设备',
            sort_order: 10,
            lv3: [
              {
                name: '半导体设备与零部件',
                sort: 10,
                m1: '先进制造',
                m2: '高端装备制造',
                kw: '半导体设备,量测设备,真空零部件,射频电源',
                pri: 88,
              },
            ],
          },
        ],
      },
    ],
  },
];

function normNullable(s) {
  const t = String(s || '').trim();
  return t.length ? t.slice(0, 100) : null;
}

function normKw(s) {
  const t = String(s || '').trim();
  return t.length ? t.slice(0, 500) : null;
}

/**
 * @param {import('mysql2/promise').Pool} dbPool
 */
async function seedDefaultSourcingTracks(dbPool) {
  const [cntRows] = await dbPool.query(`SELECT COUNT(*) AS c FROM sourcing_track WHERE is_deleted = 0`);
  if (Number(cntRows[0].c || 0) > 0) {
    return;
  }

  let leafCount = 0;
  for (let ti = 0; ti < DEFAULT_TRACK_TREE.length; ti++) {
    const tr = DEFAULT_TRACK_TREE[ti];
    const [trRes] = await dbPool.execute(`INSERT INTO sourcing_track (name, sort_order) VALUES (?,?)`, [
      tr.name.slice(0, 100),
      tr.sort_order,
    ]);
    const trackId = trRes.insertId;

    for (let li = 0; li < tr.lv1.length; li++) {
      const l1 = tr.lv1[li];
      const [l1Res] = await dbPool.execute(
        `INSERT INTO sourcing_track_lv1 (track_id, name, sort_order) VALUES (?,?,?)`,
        [trackId, l1.name.slice(0, 100), l1.sort_order]
      );
      const lv1Id = l1Res.insertId;

      for (let lj = 0; lj < l1.lv2.length; lj++) {
        const l2 = l1.lv2[lj];
        const [l2Res] = await dbPool.execute(
          `INSERT INTO sourcing_track_lv2 (lv1_id, name, sort_order) VALUES (?,?,?)`,
          [lv1Id, l2.name.slice(0, 100), l2.sort_order]
        );
        const lv2Id = l2Res.insertId;

        for (let lk = 0; lk < l2.lv3.length; lk++) {
          const leaf = l2.lv3[lk];
          await dbPool.execute(
            `INSERT INTO sourcing_track_lv3 (lv2_id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority, is_deleted)
             VALUES (?,?,?,?,?,?,?,0)`,
            [
              lv2Id,
              leaf.name.slice(0, 100),
              leaf.sort,
              normNullable(leaf.m1),
              normNullable(leaf.m2),
              normKw(leaf.kw),
              Number.isFinite(leaf.pri) ? leaf.pri : 0,
            ]
          );
          leafCount++;
        }
      }
    }
  }

  console.log(`✓ 已写入默认赛道树（人工智能/生物医药/半导体），共 ${leafCount} 条三级匹配节点`);
}

module.exports = {
  DEFAULT_TRACK_TREE,
  seedDefaultSourcingTracks,
};
