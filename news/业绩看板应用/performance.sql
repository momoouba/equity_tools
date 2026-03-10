SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for b_all_indicator
-- ----------------------------
DROP TABLE IF EXISTS `b_all_indicator`;
CREATE TABLE `b_all_indicator`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `fund_inv` int NULL DEFAULT NULL COMMENT '子基金累计投资数量',
  `lm_fund_inv` int NULL DEFAULT NULL COMMENT '上月累计子基金投资数量',
  `fund_inv_change` int NULL DEFAULT NULL COMMENT '子基金累计投资数量变动',
  `fund_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计认缴金额',
  `lm_fund_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月子基金累计认缴金额',
  `fund_sub_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计认缴金额变动',
  `fund_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计实缴金额',
  `lm_fund_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月子基金累计实缴金额',
  `fund_paidin_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计实缴金额变动',
  `fund_exit` int NULL DEFAULT NULL COMMENT '子基金累计退出数量',
  `lm_fund_exit` int NULL DEFAULT NULL COMMENT '上月子基金累计退出数量',
  `fund_exit_change` int NULL DEFAULT NULL COMMENT '子基金累计退出数量变动',
  `fund_exit_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计退出金额',
  `lm_fund_exit_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月子基金累计退出金额',
  `fund_exit_amount_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计退出金额变动',
  `fund_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计回款金额',
  `lm_fund_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月子基金累计回款金额',
  `fund_receive_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金累计回款金额变动',
  `project_inv` int NULL DEFAULT NULL COMMENT '累计直投项目数量',
  `lm_project_inv` int NULL DEFAULT NULL COMMENT '上月累计直投项目数量',
  `project_inv_change` int NULL DEFAULT NULL COMMENT '累计直投项目数量变动',
  `project_paidin` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '直投项目累计投资金额',
  `lm_project_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月直投项目累计投资金额',
  `project_exit` int NULL DEFAULT NULL COMMENT '直投项目累计退出数量',
  `lm_project_exit` int NULL DEFAULT NULL COMMENT '上月直投项目累计退出数量',
  `project_exit_change` int NULL DEFAULT NULL COMMENT '直投项目累计退出数量变动',
  `project_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投项目累计回款金额',
  `lm_project_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月直投项目累计回款金额',
  `project_receive_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投项目累计回款金额变动',
  `project_paidin_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投项目累计投资金额变动',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-管理人整体指标' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_investment
-- ----------------------------
DROP TABLE IF EXISTS `b_investment`;
CREATE TABLE `b_investment`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称-4',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `transaction_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '投资类别-6',
  `acc_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴金额累计-9',
  `change_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴金额本月变动-10',
  `acc_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '实缴金额累计-11',
  `change_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '实缴金额本月变动-12',
  `acc_exit` decimal(30, 10) NULL DEFAULT NULL COMMENT '退出金额累计-13',
  `change_exit` decimal(30, 10) NULL DEFAULT NULL COMMENT '退出金额本月变动-14',
  `acc_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '回款金额累计-15',
  `change_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '回款金额本月变动-16',
  `project` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '项目名称-7',
  `first_date` datetime NULL DEFAULT NULL COMMENT '首次投资时间-8',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型-3',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间-5',
  `unrealized` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '未实现价值-17',
  `change_unrealized` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '未实现价值变动-18',
  `total_value` decimal(30, 10) NULL DEFAULT NULL COMMENT '总价值-19',
  `moc` decimal(30, 10) NULL DEFAULT NULL COMMENT 'MOC-20',
  `dpi` decimal(30, 10) NULL DEFAULT NULL COMMENT 'DPI-21',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `acc_exit_profit` decimal(30, 10) NULL DEFAULT NULL COMMENT '累计退出收益-23',
  `acc_exit_capital` decimal(30, 10) NULL DEFAULT NULL COMMENT '累计退出成本-22',
  `acc_dividend` decimal(30, 10) NULL DEFAULT NULL COMMENT '其中:累计分红-24',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-基金投资组合明细' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_investment_indicator
-- ----------------------------
DROP TABLE IF EXISTS `b_investment_indicator`;
CREATE TABLE `b_investment_indicator`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称',
  `fund_inv` int NULL DEFAULT NULL COMMENT '子基金投资数量',
  `fund_exit` int NULL DEFAULT NULL COMMENT '子基金退出数量',
  `fund_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金认缴金额',
  `fund_exit_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金退出金额',
  `fund_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金实缴金额',
  `fund_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金回款金额',
  `project_inv` int NULL DEFAULT NULL COMMENT '直投项目投资数量',
  `project_exit` int NULL DEFAULT NULL COMMENT '直投项目退出数量',
  `project_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投项目实缴金额',
  `project_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投项目回款金额',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-基金投资组合指标' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_investment_sum
-- ----------------------------
DROP TABLE IF EXISTS `b_investment_sum`;
CREATE TABLE `b_investment_sum`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `transaction_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '投资类别-3',
  `acc_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴金额累计-5',
  `change_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴金额本月变动-6',
  `acc_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '实缴金额累计-7',
  `change_paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '实缴金额本月变动-8',
  `acc_exit` decimal(30, 10) NULL DEFAULT NULL COMMENT '退出金额累计-9',
  `change_exit` decimal(30, 10) NULL DEFAULT NULL COMMENT '退出金额本月变动-10',
  `acc_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '回款金额累计-11',
  `change_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '回款金额本月变动-12',
  `project` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '项目名称-4',
  `unrealized` decimal(30, 10) NULL DEFAULT NULL COMMENT '未实现价值-13',
  `change_unrealized` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '未实现价值变动-14',
  `total_value` decimal(30, 10) NULL DEFAULT NULL COMMENT '总价值-15',
  `moc` decimal(30, 10) NULL DEFAULT NULL COMMENT 'MOC-16',
  `dpi` decimal(30, 10) NULL DEFAULT NULL COMMENT 'DPI-17',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-基金投资组合明细汇总' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_investor_list
-- ----------------------------
DROP TABLE IF EXISTS `b_investor_list`;
CREATE TABLE `b_investor_list`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称-3',
  `lp` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '投资人名称-5',
  `subscription_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴金额-6',
  `subscription_ratio` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴比例-7',
  `distribution` decimal(30, 10) NULL DEFAULT NULL COMMENT '累计分配金额-9',
  `paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '累计实缴金额-8',
  `first_date` datetime NULL DEFAULT NULL COMMENT '第N次分配时间-10',
  `first_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '第N次分配金额-11',
  `second_date` datetime NULL DEFAULT NULL COMMENT '第N-1次分配时间-12',
  `second_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '第N-1次分配金额-13',
  `third_date` datetime NULL DEFAULT NULL COMMENT '第N-2次分配时间-14',
  `third_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '第N-2次分配金额-15',
  `lp_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '投资人类型-4',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-投资人名录' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_ipo
-- ----------------------------
DROP TABLE IF EXISTS `b_ipo`;
CREATE TABLE `b_ipo`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `project` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '项目简称-5',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '所属基金-3',
  `amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资金额-9',
  `ipo_date` datetime NULL DEFAULT NULL COMMENT '上市日期-08',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型-4',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `stock_name` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '股票简称-6',
  `stock_num` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '股票代码-7',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-上市企业明细' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_ipo_a
-- ----------------------------
DROP TABLE IF EXISTS `b_ipo_a`;
CREATE TABLE `b_ipo_a`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `project` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '项目简称-5',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '所属基金-3',
  `amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资金额-9',
  `ipo_date` datetime NULL DEFAULT NULL COMMENT '上市日期-8',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型-4',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `stock_num` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '股票代码-7',
  `stock_name` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '股票简称-6',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-上市企业明细-累计' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_manage
-- ----------------------------
DROP TABLE IF EXISTS `b_manage`;
CREATE TABLE `b_manage`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称-04',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型-03',
  `sub_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '认缴规模-06',
  `paid_in_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '实缴规模-08',
  `dis_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '累计分配金额-10',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-02',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-01',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间-05',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `sub_add` decimal(30, 10) NULL DEFAULT NULL COMMENT '本年新增认缴-07',
  `paid_in_add` decimal(30, 10) NULL DEFAULT NULL COMMENT '本年新增实缴-09',
  `dis_add` decimal(30, 10) NULL DEFAULT NULL COMMENT '本年新增分配-11',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-管理规模' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_manage_indicator
-- ----------------------------
DROP TABLE IF EXISTS `b_manage_indicator`;
CREATE TABLE `b_manage_indicator`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `fof_num` int NULL DEFAULT NULL COMMENT '母基金数量',
  `direct_num` int NULL DEFAULT NULL COMMENT '直投基金数量',
  `sub_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '认缴管理规模',
  `paid_in_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '实缴管理规模',
  `dis_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '累计分配金额',
  `sub_add` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '认缴规模较上年变动',
  `paid_in_add` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '实缴规模较上年度变动',
  `dis_add` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '累计分配总额较上年度变动',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-管理人指标显示' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_project
-- ----------------------------
DROP TABLE IF EXISTS `b_project`;
CREATE TABLE `b_project`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称',
  `company_num` int NULL DEFAULT NULL COMMENT '被投企业数量',
  `ipo_num` int NULL DEFAULT NULL COMMENT '上市企业数量',
  `csj_num` int NULL DEFAULT NULL COMMENT '长三角企业数量',
  `total_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '总投资金额',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间',
  `sh_num` int NULL DEFAULT NULL COMMENT '上海项目数量',
  `ipo_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上市企业投资金额',
  `project_num` int NULL DEFAULT NULL COMMENT '投资项目数量',
  `sh_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海项目投资金额',
  `project_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '穿透投资金额',
  `csj_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区投资金额',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-底层资产明细' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_project_a
-- ----------------------------
DROP TABLE IF EXISTS `b_project_a`;
CREATE TABLE `b_project_a`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称',
  `company_num` int NULL DEFAULT NULL COMMENT '被投企业数量',
  `total_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '总投资金额',
  `ipo_num` int NULL DEFAULT NULL COMMENT '上市企业数量',
  `ipo_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上市企业投资金额',
  `project_num` int NULL DEFAULT NULL COMMENT '投资项目数量',
  `project_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '穿透金额',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-底层资产明细-累计' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_project_all
-- ----------------------------
DROP TABLE IF EXISTS `b_project_all`;
CREATE TABLE `b_project_all`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `company_num` int NULL DEFAULT NULL COMMENT '被投企业数量',
  `lm_company_num` int NULL DEFAULT NULL COMMENT '上月被投企业数量',
  `company_num_change` int NULL DEFAULT NULL COMMENT '被投企业数量变动',
  `ipo_num` int NULL DEFAULT NULL COMMENT '上市企业数量',
  `lm_ipo_num` int NULL DEFAULT NULL COMMENT '上月上市企业数量',
  `ipo_num_change` int NULL DEFAULT NULL COMMENT '上市企业数量变动',
  `csj_num` int NULL DEFAULT NULL COMMENT '长三角企业数量',
  `lm_csj_num` int NULL DEFAULT NULL COMMENT '上月长三角企业数量',
  `csj_num_change` int NULL DEFAULT NULL COMMENT '长三角企业数量变动',
  `total_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '总投资金额',
  `lm_total_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '上月总投资金额',
  `total_amount_change` decimal(30, 10) NULL DEFAULT NULL COMMENT '总投资金额变动',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `sh_num` int NULL DEFAULT NULL COMMENT '上海企业数量',
  `lm_sh_num` int NULL DEFAULT NULL COMMENT '上月上海企业数量',
  `sh_num_change` int NULL DEFAULT NULL COMMENT '上海企业数量变动',
  `sh_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海企业投资金额',
  `csj_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区投资金额',
  `ipo_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上市项目投资金额',
  `company_num_a` int NULL DEFAULT NULL COMMENT '被投企业数量-累计',
  `project_num` int NULL DEFAULT NULL COMMENT '项目数量',
  `project_num_a` int NULL DEFAULT NULL COMMENT '项目数量-累计',
  `total_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '总投资金额-累计',
  `ct_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '穿透金额',
  `ct_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '穿透金额-累计',
  `ipo_num_a` int NULL DEFAULT NULL COMMENT '上市企业数量-累计',
  `ipo_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上市项目投资金额-累计',
  `sh_num_a` int NULL DEFAULT NULL COMMENT '上海企业数量-累计',
  `sh_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海企业投资金额-累计',
  `csj_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区投资金额-累计',
  `csj_num_a` int NULL DEFAULT NULL COMMENT '长三角企业数量-累计',
  `pd_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区企业投资金额',
  `pd_amount_a` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区企业投资金额-累计',
  `pd_num` int NULL DEFAULT NULL COMMENT '浦东地区投资数量',
  `pd_num_a` int NULL DEFAULT NULL COMMENT '浦东地区投资数量-累计',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-底层资产指标' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_region
-- ----------------------------
DROP TABLE IF EXISTS `b_region`;
CREATE TABLE `b_region`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间',
  `csj_num` int NULL DEFAULT NULL COMMENT '长三角地区企业数量',
  `csj_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区企业投资金额',
  `sh_num` int NULL DEFAULT NULL COMMENT '上海地区企业数量',
  `sh_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海地区投资金额',
  `pd_num` int NULL DEFAULT NULL COMMENT '浦东地区企业数量',
  `pd_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区投资金额',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `t_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '总投资金额',
  `sh_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海数量占比',
  `sh_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海金额占比',
  `csj_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角数量占比',
  `csj_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角金额占比',
  `pd_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东数量占比',
  `pd_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东金额占比',
  `t_num` int NULL DEFAULT NULL COMMENT '总项目数量',
  `csj_amount_ct` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区金额_穿透',
  `sh_amount_ct` decimal(30, 10) NULL DEFAULT NULL COMMENT '上海地区金额_穿透',
  `pd_amount_ct` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区金额_穿透',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-区域企业明细' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_region_a
-- ----------------------------
DROP TABLE IF EXISTS `b_region_a`;
CREATE TABLE `b_region_a`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间',
  `csj_num` int NULL DEFAULT NULL COMMENT '长三角地区企业数量',
  `csj_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区企业投资金额',
  `sh_num` int NULL DEFAULT NULL COMMENT '上海地区企业数量',
  `sh_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海地区投资金额',
  `pd_num` int NULL DEFAULT NULL COMMENT '浦东地区企业数量',
  `pd_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区投资金额',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `t_amount` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '总投资金额',
  `sh_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海数量占比',
  `sh_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海金额占比',
  `csj_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角数量占比',
  `csj_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角金额占比',
  `pd_num_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东数量占比',
  `pd_amount_ratio` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东金额占比',
  `t_num` int NULL DEFAULT NULL COMMENT '总项目数量',
  `csj_amount_ct` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '长三角地区金额_穿透',
  `sh_amount_ct` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '上海地区金额_穿透',
  `pd_amount_ct` decimal(30, 10) NULL DEFAULT 0.0000000000 COMMENT '浦东地区金额_穿透',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-区域企业明细-累计' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_transaction
-- ----------------------------
DROP TABLE IF EXISTS `b_transaction`;
CREATE TABLE `b_transaction`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称-3',
  `spv` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT 'spv名称-5',
  `sub_fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '子基金名称-6',
  `company` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '被投企业名称-7',
  `transaction_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '交易类型-8',
  `transaction_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '交易金额-10',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `lp` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '投资人名称-4',
  `transaction_date` datetime NULL DEFAULT NULL COMMENT '交易时间-9',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `company_name` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '被投企业全称-16',
  `sub_fund_name` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '子基金全称-17',
  `capital` decimal(30, 10) NULL DEFAULT NULL COMMENT '分配成本-11',
  `profit` decimal(30, 10) NULL DEFAULT NULL COMMENT '分配收益-12',
  `dividend` decimal(30, 10) NULL DEFAULT NULL COMMENT '其中:分红-13',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板--交易明细底表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_transaction_indicator
-- ----------------------------
DROP TABLE IF EXISTS `b_transaction_indicator`;
CREATE TABLE `b_transaction_indicator`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NOT NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号-2',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件-1',
  `inv_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资金额/实缴-14',
  `moc` decimal(30, 10) NULL DEFAULT NULL COMMENT 'MOC-16',
  `girr` decimal(30, 10) NULL DEFAULT NULL COMMENT 'GIRR-17',
  `nirr` decimal(30, 10) NULL DEFAULT NULL COMMENT 'NIRR-12',
  `paidin` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资人实缴-7',
  `distribution` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资人分配-8',
  `dpi` decimal(30, 10) NULL DEFAULT NULL COMMENT 'DPI-10',
  `rvpi` decimal(30, 10) NULL DEFAULT NULL COMMENT 'RVPI-11',
  `tvpi` decimal(30, 10) NULL DEFAULT NULL COMMENT 'TVPI-9',
  `fund` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金名称-3',
  `sub_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资金额/认缴-13',
  `lp_sub` decimal(30, 10) NULL DEFAULT NULL COMMENT '投资人认缴-6',
  `exit_amount` decimal(30, 10) NULL DEFAULT NULL COMMENT '退出金额-15',
  `fund_type` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '基金类型-4',
  `set_up_date` datetime NULL DEFAULT NULL COMMENT '成立时间-5',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `d_moc` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投整体MOC-18',
  `d_dpi` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投DPI-19',
  `d_paid` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投实缴-20',
  `d_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投回款-21',
  `sf_moc` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金整体MOC-24',
  `sf_dpi` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金DPI-25',
  `sf_paid` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金实缴-26',
  `sf_receive` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金回款-27',
  `d_unrealized` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投未实现价值-22',
  `dt_value` decimal(30, 10) NULL DEFAULT NULL COMMENT '直投总价值-23',
  `sf_unrealized` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金未实现价值-28',
  `sft_value` decimal(30, 10) NULL DEFAULT NULL COMMENT '子基金总价值-29',
  `net_asset` decimal(30, 10) NULL DEFAULT NULL COMMENT '资本账户-30',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '定开看板-基金产品指标' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_version
-- ----------------------------
DROP TABLE IF EXISTS `b_version`;
CREATE TABLE `b_version`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `b_date` datetime NULL DEFAULT NULL COMMENT '时间条件',
  `version` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '版本号',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '管理人看板版本管理' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_indicator_describe
-- ----------------------------
DROP TABLE IF EXISTS `b_indicator_describe`;
CREATE TABLE `b_indicator_describe`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_LastModifyUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '修改用户',
  `F_LastModifyTime` datetime NULL DEFAULT NULL COMMENT '修改时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  `system_name` text COMMENT '系统名称',
  `manual_url` text COMMENT '操作手册地址',
  `redirect_url` text COMMENT '页面跳转地址',
  `fof_num_desc` text COMMENT '母基金数量',
  `direct_num_desc` text COMMENT '直投基金数量',
  `sub_amount_desc` text COMMENT '认缴管理规模',
  `paid_in_amount_desc` text COMMENT '实缴管理规模',
  `dis_amount_desc` text COMMENT '累计分配总额',
  `lp_sub_desc` text COMMENT '投资人认缴',
  `paidin_desc` text COMMENT '投资人实缴',
  `distribution_desc` text COMMENT '投资人分配',
  `tvpi_desc` text COMMENT 'TVPI',
  `dpi_desc` text COMMENT 'DPI',
  `rvpi_desc` text COMMENT 'RVPI',
  `nirr_desc` text COMMENT 'NIRR',
  `sub_amount_inv_desc` text COMMENT '投资金额_认缴',
  `inv_amount_desc` text COMMENT '投资金额_实缴',
  `exit_amount_desc` text COMMENT '退出金额',
  `girr_desc` text COMMENT 'GIRR',
  `moc_desc` text COMMENT 'MOC',
  `fund_inv_exit_desc` text COMMENT '子基金_投_退数量',
  `fund_sub_exit_desc` text COMMENT '子基金_认缴_退出',
  `fund_paidin_receive_desc` text COMMENT '子基金_实缴_回款',
  `project_inv_exit_desc` text COMMENT '直投项目_投_退数量',
  `project_paidin_receive_desc` text COMMENT '直投项目_实缴_回款',
  `fund_inv_acc_desc` text COMMENT '子基金_累计投资数量',
  `fund_sub_acc_desc` text COMMENT '子基金_累计认缴金额',
  `fund_paidin_acc_desc` text COMMENT '子基金_累计实缴金额',
  `fund_exit_acc_desc` text COMMENT '子基金_累计退出数量',
  `fund_exit_amount_acc_desc` text COMMENT '子基金_累计退出金额',
  `fund_receive_acc_desc` text COMMENT '子基金_累计回款金额',
  `project_inv_acc_desc` text COMMENT '直投项目_累计投资数量',
  `project_paidin_acc_desc` text COMMENT '直投项目_累计投资金额',
  `project_exit_acc_desc` text COMMENT '直投项目_累计退出数量',
  `project_exit_amount_acc_desc` text COMMENT '直投项目_累计退出金额',
  `project_receive_acc_desc` text COMMENT '直投项目_累计回款金额',
  `project_num_a_desc` text COMMENT '累计组合_底层资产_数量',
  `total_amount_a_desc` text COMMENT '累计组合_底层资产_金额',
  `ipo_num_a_desc` text COMMENT '累计组合_上市企业',
  `sh_num_a_desc` text COMMENT '累计组合_上海地区企业',
  `project_num_desc` text COMMENT '当前组合_底层资产_数量',
  `total_amount_desc` text COMMENT '当前组合_底层资产_金额',
  `ipo_num_desc` text COMMENT '当前组合_上市企业',
  `sh_num_desc` text COMMENT '当前组合_上海地区企业',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '管理人看板说明' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for b_sql
-- 说明：仅 b_sql（及 b_sql_change_log）保留 F_LastModifyUserId/F_LastModifyTime；其余 b_ 表在初始化时不包含且会删除这两列。
-- ----------------------------
DROP TABLE IF EXISTS `b_sql`;
CREATE TABLE `b_sql`  (
  `F_Id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '主键',
  `F_CreatorUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '创建用户',
  `F_CreatorTime` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `F_LastModifyUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '修改用户',
  `F_LastModifyTime` datetime NULL DEFAULT NULL COMMENT '修改时间',
  `F_DeleteUserId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '删除用户',
  `F_DeleteMark` int NULL DEFAULT 0 COMMENT '删除状态',
  `F_DeleteTime` datetime NULL DEFAULT NULL COMMENT '删除时间',
  `database_name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '数据库选择',
  `interface_name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '接口名称',
  `sql_content` longtext COMMENT '查询sql',
  `exec_order` int NULL DEFAULT 0 COMMENT '执行顺序',
  `F_Lock` int NULL DEFAULT 0 COMMENT '锁定状态',
  PRIMARY KEY (`F_Id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT = '管理人数据接口' ROW_FORMAT = Dynamic;
SET FOREIGN_KEY_CHECKS = 1;
