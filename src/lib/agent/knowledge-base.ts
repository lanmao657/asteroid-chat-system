import type { KnowledgeBaseDocument } from "@/lib/agent/types";

export const knowledgeBaseDocuments: KnowledgeBaseDocument[] = [
  {
    id: "kb-expense-reimbursement-policy",
    title: "员工费用报销制度（2026 版）",
    category: "制度政策",
    source: "internal-doc",
    url: "kb://enterprise/policies/expense-reimbursement-2026",
    tags: ["报销", "财务", "制度", "审批", "发票"],
    department: "财务与行政",
    applicableRoles: ["全员", "部门主管", "HRBP"],
    updatedAt: "2026-03-18",
    content:
      "差旅、客户接待、办公采购等费用必须先确认预算归属，再在 5 个工作日内提交报销。单笔 1000 元以内由直属主管审批，1000 元及以上需财务复核。发票、付款截图和业务说明缺一不可；超标餐饮、个人消费、无业务关联的打车费用不予报销。紧急采购需要在说明中补充事由和采购对象。",
  },
  {
    id: "kb-onboarding-training-playbook",
    title: "新员工入职 30 天培训手册",
    category: "培训课件",
    source: "internal-doc",
    url: "kb://enterprise/training/onboarding-30-days",
    tags: ["入职", "培训", "学习清单", "上岗", "手册"],
    department: "HR 与用人部门",
    applicableRoles: ["新员工", "带教人", "HRBP"],
    updatedAt: "2026-02-26",
    content:
      "入职第 1 周完成企业文化、信息安全、考勤与报销制度学习；第 2 周完成岗位 SOP 与核心系统演练；第 3 周跟岗观察并完成一份案例复盘；第 4 周进行上岗答辩，由直属主管确认是否独立接单。每周都要输出学习记录、待确认问题和下周行动项。",
  },
  {
    id: "kb-customer-service-refund-sop",
    title: "客服退款争议处理 SOP",
    category: "岗位流程",
    source: "internal-doc",
    url: "kb://enterprise/sop/customer-service-refund-dispute",
    tags: ["客服", "退款", "SOP", "话术", "投诉"],
    department: "客户服务",
    applicableRoles: ["客服专员", "客服主管"],
    updatedAt: "2026-04-02",
    content:
      "遇到退款争议时先确认订单状态、支付记录和退款规则，再向客户复述已核实的事实。可退场景应在 2 小时内发起退款申请，并同步预计到账时间；不可退场景要引用具体条款，提供替代方案或升级到主管处理。禁止使用带情绪判断的话术，例如“这不是我们的问题”，统一改为“我先根据订单规则帮您核对并给出处理方案”。",
  },
  {
    id: "kb-sales-product-enablement",
    title: "新版产品卖点与销售话术指引",
    category: "业务 FAQ",
    source: "internal-doc",
    url: "kb://enterprise/enablement/product-launch-selling-points",
    tags: ["销售", "产品卖点", "话术", "竞品", "FAQ"],
    department: "销售与产品市场",
    applicableRoles: ["销售", "售前", "业务主管"],
    updatedAt: "2026-03-30",
    content:
      "新版产品的核心卖点是部署更快、审计链路更清晰、跨团队协作成本更低。面对价格异议时优先强调实施周期和培训成本下降，而不是直接让价。客户问到竞品差异时，统一从上线周期、权限可追溯和复盘效率三个维度比较，避免承诺未发布功能。常见异议包括“迁移成本高”和“员工不会用”，标准回应要带上试点部门和培训支持方案。",
  },
  {
    id: "kb-project-retrospective-guide",
    title: "项目复盘模板与典型案例",
    category: "案例复盘",
    source: "internal-doc",
    url: "kb://enterprise/cases/project-retrospective-guide",
    tags: ["复盘", "案例", "项目管理", "经验教训", "模板"],
    department: "PMO",
    applicableRoles: ["项目经理", "部门主管", "培训负责人"],
    updatedAt: "2026-01-15",
    content:
      "标准复盘需要回答四个问题：目标是否达成、关键偏差在哪里、造成偏差的根因是什么、下一次如何复用经验。案例正文建议拆成背景、时间线、关键决策、结果、经验教训和改进行动。复盘不能只写结论，要补充证据和关键节点，否则后续培训难以复用。",
  },
  {
    id: "kb-policy-watch-external-reference",
    title: "外部政策与行业动态跟踪建议",
    category: "外部参考",
    source: "internal-doc",
    url: "kb://enterprise/research/policy-watch",
    tags: ["政策变化", "行业新闻", "竞品动态", "外部参考"],
    department: "战略与运营",
    applicableRoles: ["业务主管", "HRBP", "培训负责人"],
    updatedAt: "2026-03-08",
    content:
      "当问题涉及行业政策变化、监管动态、竞品发布和市场新闻时，先明确外部事实，再补充内部制度、流程或培训动作。输出时必须把“内部依据”和“外部参考”分开展示，避免员工把公开信息误认为公司正式制度。若外部信息尚未被内部制度吸收，应明确标注为“待内部确认”。",
  },
];
