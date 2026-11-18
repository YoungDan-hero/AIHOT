# GitHub周榜

`/github` 展示 GitHub Trending 周榜中的综合开源项目，按页面提供的本周涨星数降序排列。它覆盖原榜候选，不代表遍历 GitHub 所有仓库后的完整排名；不把总 Star 排名当作周涨星排名。

模块位于 `modules/github-ranking/`，通过 `site/modules/` 接入页面、接口和现有 worker。桌面侧栏及手机“我的”页均有入口。

1. 后台每6小时读取 `https://github.com/trending?since=weekly`，解析项目、周涨星、总 Star、语言及简介；通过 GitHub 仓库 API 补充项目资料。
2. 本周涨星采用 GitHub 周榜的统计口径。当前模块不混用 Star 历史统计日或本地七日净增快照；项目链接保留原仓库地址。
3. 中文简介由现有模型接口根据仓库简介整理，调用经过回执与预算；未变化的简介复用上次结果。模型不可用时保留官方原简介，数字和排名不由模型生成。
4. 完整公开结果存入现有数据库的 `module.github-ranking.snapshot` 设置项，接口 `/api/site/github-ranking` 通过公共读取层返回快照。网页访问不触发采集或模型调用；采集失败保留上次成功结果，超过12小时提示更新延迟。
5. 定时采集受 `COLLECT_ENABLED` 控制，简介生成受 `MODEL_CALLS_ENABLED` 控制，沿用当前豆包配置。可选的 `GITHUB_TOKEN` 使用已有后端采集凭据配置；不用在网页中暴露令牌。公开请求遵守项目的地址、TLS、代理与域名节流规则。

接口和页面空态在首次采集前正常可用。正式运行应观察 GitHub 页面结构变化、网络限流、任务成功时间和模型预算；无令牌时官方 REST API 基础额度为每IP每小时60次，实际以响应头为准。

数据说明：[GitHub Trending周榜](https://github.com/trending?since=weekly)、[仓库资料接口](https://docs.github.com/en/rest/repos/repos#get-a-repository)、[API限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。
