// 两次独立评分的平均值达到门槛后，仍需通过归组去重和发布规则。
// shortcut: 暂沿用引擎门槛，取得使用者标注的短剧样本后按 docs/selection.md 校准。
// 国内与海外使用相同分级与门槛，不按国别、语言或制作方式加减分。
export const SELECTION = {
  thresholds: { T1: 60, T1_5: 65, T2: 76 } as Record<string, number>,
  classes: {} as Record<string, { label: string; threshold: number }>,
  understandFloor: 50,
  browseFloor: 40,
} as const;
