// 短剧行业的分类、标签、主体名录和身份核对词典。
// 国内与海外按事件面向的市场分类，使用相同的精选标准。

/** 类别的 key 用于网址、RSS 和公开接口；section 同时用于日报栏目。 */
export const CATEGORIES = [
  { key: "domestic", tagColor: "indigo", label: "国内动态", feedLabel: "国内短剧", section: "国内动态", guide: "核心动作、适用规则或业务主要面向中国大陆短剧或新媒体市场的资讯，包括平台、制作、发行、创作者运营、商业与监管。中文信源报道海外业务仍归海外。" },
  { key: "overseas", tagColor: "turquoise", label: "海外动态", feedLabel: "海外短剧", section: "海外动态", guide: "核心动作、适用规则或业务主要面向中国大陆以外市场的短剧或新媒体资讯，包括竖屏剧、内容平台、IP与发行。中国公司出海与当地公司业务使用同一类别。英文信源报道国内事件仍归国内。" },
  { key: "industry", tagColor: "orange", label: "跨市场观察", feedLabel: "短剧跨市场观察", section: "跨市场观察", guide: "实质比较国内与海外、多个市场同等重要，或无法归属单一市场的短剧或新媒体产业研究、方法和综合观察。材料不足时category为null。" },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/** 跨市场资讯没有统一可比较的发布计数，日报不显示发布数量报头。 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

export const PLAIN_TERMS: readonly string[] = ["ai", "ip", "iap", "avod", "svod", "roi", "arpu", "ceo", "ipo", "api", "ugc", "pgc"];

/** 与 content-understanding.md 和 selection-score.md 的内容类型保持一致。 */
export const ITEM_TYPES = ["drama_release", "platform_update", "production_method", "industry_report", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

export const CATEGORY_TAGS = [
  "剧目动态", "平台更新", "制作/技术", "数据/报告", "行业动态", "政策/监管", "商业合作", "观点/分析", "教程/实践", "其他",
] as const;

export const TOPIC_TAGS = [
  "国内市场", "海外市场", "真人短剧", "AI漫剧", "AI短剧", "竖屏短剧", "横屏短剧", "免费短剧", "付费短剧", "IP改编", "发行/出海", "投流/营销", "版权/合规", "制作/编剧", "海外本土化", "品牌短剧",
] as const;

export const ENTITY_TAGS = ["红果短剧", "抖音", "快手", "腾讯视频", "优酷", "爱奇艺", "ReelShort", "DramaBox", "NetShort", "ShortMax", "GoodShort", "Wattpad", "国家广电总局", "北京市广电局"] as const;

export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "剧集发布": "剧目动态", "新剧上线": "剧目动态", "短剧上新": "剧目动态", "产品更新": "平台更新", "平台动态": "平台更新",
  "融资/收购": "行业动态", "公司动态": "行业动态", 融资: "行业动态", 收购: "行业动态", 并购: "行业动态", 人事: "行业动态",
  合作: "商业合作", "IP授权": "IP改编", "版权改编": "IP改编", 政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管",
  "研究报告": "数据/报告", "榜单数据": "数据/报告", "市场报告": "数据/报告", "教程/玩法": "教程/实践", "技巧/最佳实践": "教程/实践",
  "大佬观点": "观点/分析", "行业观点": "观点/分析", "现象/趋势": "观点/分析", "vertical drama": "竖屏短剧",
  "ai漫剧": "AI漫剧", "ai短剧": "AI短剧", 出海: "发行/出海", 译制: "海外本土化", "本土化": "海外本土化",
  "红果": "红果短剧", "红果免费短剧": "红果短剧", "reelshort": "ReelShort", "dramabox": "DramaBox", "netshort": "NetShort", "wattpad": "Wattpad",
};

/** 品牌别名用于主体识别，不把投资、合作或报道关系当成同一主体。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  hongguo: { name: "红果短剧", displayTag: "红果短剧", aliases: ["红果", "红果免费短剧", "Hongguo"], orgNames: ["红果短剧"] },
  douyin: { name: "抖音", displayTag: "抖音", aliases: ["Douyin"], orgNames: ["抖音"] },
  kuaishou: { name: "快手", displayTag: "快手", aliases: ["Kuaishou"], orgNames: ["快手"] },
  "tencent-video": { name: "腾讯视频", displayTag: "腾讯视频", aliases: ["Tencent Video", "WeTV"], orgNames: ["腾讯视频"] },
  youku: { name: "优酷", displayTag: "优酷", aliases: ["Youku"], orgNames: ["优酷"] },
  iqiyi: { name: "爱奇艺", displayTag: "爱奇艺", aliases: ["iQIYI", "IQiyi"], orgNames: ["爱奇艺"] },
  "crazy-maple": { name: "Crazy Maple Studio / ReelShort", displayTag: "ReelShort", aliases: ["Crazy Maple Studio", "Crazy Maple Studios", "枫叶互动", "ReelShort", "ReelShort / Crazy Maple Studio"], orgNames: ["Crazy Maple Studio", "枫叶互动"], otherNames: ["ReelShort"] },
  dramabox: { name: "DramaBox", displayTag: "DramaBox", aliases: ["DramaBox"], orgNames: ["DramaBox"] },
  netshort: { name: "NetShort", displayTag: "NetShort", aliases: ["NetShort"], orgNames: ["NetShort"] },
  shortmax: { name: "ShortMax", displayTag: "ShortMax", aliases: ["ShortMax"], orgNames: ["ShortMax"] },
  goodshort: { name: "GoodShort", displayTag: "GoodShort", aliases: ["GoodShort"], orgNames: ["GoodShort"] },
  wattpad: { name: "Wattpad", displayTag: "Wattpad", aliases: ["Wattpad"], orgNames: ["Wattpad"] },
  nrta: { name: "国家广播电视总局", displayTag: "国家广电总局", aliases: ["国家广电总局", "国家广播电视总局", "NRTA"], orgNames: ["国家广播电视总局"] },
  "beijing-gdj": { name: "北京市广播电视局", displayTag: "北京市广电局", aliases: ["北京市广电局", "北京市广播电视局"], orgNames: ["北京市广播电视局"] },
};

/** 标题摘要出现的平台或机构必须有原文依据，不能从信源或竞品关系猜出。 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "hongguo", name: "红果短剧", patterns: [/红果|\bhongguo\b/i] },
  { id: "douyin", name: "抖音", patterns: [/抖音|\bdouyin\b/i] },
  { id: "kuaishou", name: "快手", patterns: [/快手|\bkuaishou\b/i] },
  { id: "tencent-video", name: "腾讯视频", patterns: [/腾讯视频|\btencent\s+video\b|\bwetv\b/i] },
  { id: "youku", name: "优酷", patterns: [/优酷|\byouku\b/i] },
  { id: "iqiyi", name: "爱奇艺", patterns: [/爱奇艺|\biqiyi\b/i] },
  { id: "crazy-maple", name: "ReelShort", patterns: [/\breelshort\b|crazy\s+maple\s+studios?|枫叶互动/i] },
  { id: "dramabox", name: "DramaBox", patterns: [/\bdramabox\b/i] },
  { id: "netshort", name: "NetShort", patterns: [/\bnetshort\b/i] },
  { id: "shortmax", name: "ShortMax", patterns: [/\bshortmax\b/i] },
  { id: "goodshort", name: "GoodShort", patterns: [/\bgoodshort\b/i] },
  { id: "wattpad", name: "Wattpad", patterns: [/\bwattpad\b/i] },
  { id: "nrta", name: "国家广电总局", patterns: [/国家广播电视总局|国家广电总局|\bnrta\b/i] },
  { id: "beijing-gdj", name: "北京市广电局", patterns: [/北京市广播电视局|北京市广电局/i] },
];

/** 只把已确认的官网域名记为该主体的发布方，行业媒体不自动代表被报道平台。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "nrta", domains: ["nrta.gov.cn"] },
  { entityId: "beijing-gdj", domains: ["gdj.beijing.gov.cn"] },
  { entityId: "wattpad", domains: ["wattpad.com"] },
  { entityId: "crazy-maple", domains: ["reelshort.com", "crazymaplestudios.com"] },
  { entityId: "dramabox", domains: ["dramabox.com"] },
];

export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
