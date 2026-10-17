// ============================================================
// ads.js — 广告位抽象层（预留接口，平台适配器模式，与 user.js 同构）
// ============================================================
// 【设计】业务代码只调 AdManager 门面，各平台广告 SDK 差异封装在
// Provider 中；PlatformEnv.runtime() 自动路由。
//
// 广告位类型（小游戏生态标准三类）：
//   rewarded      激励视频 —— 看完换奖励（复活/双倍/道具），最重要
//   interstitial  插屏     —— 关卡间隙弹出，门面层自带频控
//   banner        横幅     —— 页面底部常驻
//
// 预留广告位规划（placement 标识，业务接入时对号入座）：
//   'revive'        死亡复活        （激励视频：game.restart 流程）
//   'double_score'  通关双倍分数    （激励视频：结算画面按钮）
//   'item_gift'     免费道具        （激励视频：菜单/HUD 按钮）
//   'level_gap'     关卡间隙        （插屏：_advanceToNextLevel 前）
//   'menu_banner'   菜单底部        （横幅：_renderMenu 进入时）
//
// 业务接入示例（复活）：
//   AdManager.showRewarded('revive',
//       () => player.revive(),                       // 看完发奖
//       (ok) => { if (!ok) /* 未看完/拉取失败 */ });  // 关闭回调
//
// 开发期行为（AD_CONFIG.enabled = false）：
//   所有广告调用走 Mock——立即回调发奖 + console.log，业务流程可全测；
//   isReady() 恒 true（方便开发期看到"看广告"入口）。
// 正式接入（enabled = true）：
//   注册平台 Provider（如 WechatAdProvider）后自动路由；未注册回退 Mock。
// ============================================================

// ---------- 配置 ----------
const AD_CONFIG = {
    enabled: false,             // 总开关：正式接入平台广告后改 true
    interstitialMinGap: 60000,  // 插屏广告最小间隔(ms)，防骚扰
};

// ---------- 门面 ----------
const AdManager = {
    _providers: null,          // 注册表 { 'wechat': WechatAdProvider, ... }
    _provider: null,           // 当前生效 Provider
    _lastInterstitial: 0,      // 上次插屏时间（频控）

    // 注册平台广告提供者（name 与 PlatformEnv.runtime() 对齐）
    register(provider) {
        this._providers = this._providers || {};
        this._providers[provider.name] = provider;
    },

    // 启动初始化：按运行环境路由（幂等，可重复调用）
    init() {
        const rt = (typeof PlatformEnv !== 'undefined')
            ? PlatformEnv.runtime() : 'web';
        this._providers = this._providers || {};
        this._provider = this._providers[rt] || WebAdProvider;
        if (rt !== 'web' && this._provider === WebAdProvider) {
            console.warn(`[Ad] 检测到 ${rt} 环境但未注册广告提供者，回退 Mock`);
        }
        console.log(`[Ad] 就绪: ${AD_CONFIG.enabled ? '已启用' : '开发模式(Mock)'} | provider=${this._provider.name}`);
        return this._provider;
    },

    // 广告是否可用（业务用它决定"看广告"按钮显隐）
    // 开发模式恒 true（入口可见、流程可测）；正式模式问平台 SDK
    isReady(type) {
        if (!AD_CONFIG.enabled) return true;
        return this._provider.isReady ? this._provider.isReady(type) : false;
    },

    // 预加载（平台支持时提前拉取，如进入菜单时预热激励视频）
    preload(type) {
        if (!AD_CONFIG.enabled) return;
        this._provider.preload && this._provider.preload(type);
    },

    // 激励视频：onReward = 看完发奖；onDone(ok) = 关闭时是否拿到奖励
    showRewarded(placement, onReward, onDone) {
        if (!AD_CONFIG.enabled) {
            console.log(`[Ad] Mock 激励视频（${placement}）→ 立即发奖`);
            onReward && onReward();
            onDone && onDone(true);
            return true;
        }
        return this._provider.showRewarded(placement, onReward, onDone);
    },

    // 插屏：门面层频控（间隔未到直接拦截，返回 false）
    showInterstitial(placement) {
        const now = Date.now();
        if (now - this._lastInterstitial < AD_CONFIG.interstitialMinGap) {
            console.log('[Ad] 插屏频控拦截（间隔未到）');
            return false;
        }
        this._lastInterstitial = now;
        if (!AD_CONFIG.enabled) {
            console.log(`[Ad] Mock 插屏（${placement}）`);
            return true;
        }
        return this._provider.showInterstitial(placement);
    },

    // 横幅：show/hide 成对调用（进菜单 show、进游戏 hide）
    showBanner(placement) {
        if (!AD_CONFIG.enabled) {
            console.log(`[Ad] Mock 横幅（${placement}）`);
            return true;
        }
        return this._provider.showBanner ? this._provider.showBanner(placement) : false;
    },
    hideBanner() {
        if (!AD_CONFIG.enabled) return;
        this._provider.hideBanner && this._provider.hideBanner();
    },
};

// ---------- Web Mock 提供者（开发期默认）----------
const WebAdProvider = {
    name: 'web',
    isReady() { return true; },
    showRewarded(placement, onReward, onDone) {
        console.log(`[Ad] Mock 激励视频播放（${placement}）`);
        onReward && onReward();
        onDone && onDone(true);
        return true;
    },
    showInterstitial(placement) {
        console.log(`[Ad] Mock 插屏（${placement}）`);
        return true;
    },
    showBanner(placement) {
        console.log(`[Ad] Mock 横幅（${placement}）`);
        return true;
    },
    hideBanner() {},
};

// ---------- 微信小游戏提供者（占位桩：开通流量主后实现）----------
// 前提：微信小游戏接入微信流量主（累计独立访客达标后开通）
// 接入步骤：
//   1. 微信后台创建广告位 → 填入 _ids 映射（placement → 广告单元 ID）
//   2. 实现以下接口，平台入口 AdManager.register(WechatAdProvider)
//      （env.js 检测到 wechat 宿主自动路由；AD_CONFIG.enabled 改 true）
// const WechatAdProvider = {
//     name: 'wechat',
//     _ids: { revive: 'adunit-xxx', double_score: 'adunit-xxx',
//             item_gift: 'adunit-xxx', level_gap: 'adunit-xxx', menu_banner: 'adunit-xxx' },
//     _rewarded: null, _interstitial: null, _banner: null,
//     // 激励视频：单例创建 + onLoad 预加载 + onError 重建
//     // showRewarded(placement, onReward, onDone) {
//     //     const ad = this._ensureRewarded(this._ids[placement]);
//     //     ad.onClose(res => {
//     //         const ok = res && (res.isEnded || res.isEnded === undefined); // 看完/非正常结束判定
//     //         if (ok) onReward && onReward();
//     //         onDone && onDone(!!ok);
//     //         ad.offClose(); ad.load();          // 复位监听 + 预载下一次
//     //     });
//     //     ad.show().catch(() => { onDone && onDone(false); });  // 拉取失败不发奖
//     // },
//     // 插屏：wx.createInterstitialAd({ adUnitId })
//     // 横幅：wx.createBannerAd({ adUnitId, adIntervals }) → show/hide/destroy
// };

// 启动即初始化（开发模式 Mock，无网络请求）
AdManager.init();

// 导出全局（Node 测试 / 小程序环境同样可用）
globalThis.AdManager = AdManager;
