// ============================================================
// env.js — 运行环境 / 终端检测（零依赖，可独立使用）
// ============================================================
// 【端识别】玩家从什么终端进入游戏，一处检测、全局可用。
// 三个维度：
//   1. runtime 运行环境：决定登录方式路由（UserAuth 选适配器）
//      'web' | 'wechat' | 'douyin' | 'alipay'
//   2. device 设备形态：决定触控 UI 显隐 / CRT 特效降级 / 横屏提示
//      'pc' | 'mobile' | 'tablet'
//   3. channel 渠道来源：URL ?channel=xxx（运营统计埋点），缺省 'direct'
//
// 游戏侧用法：
//   PlatformEnv.runtime()  → 'web' | 'wechat' | 'douyin' | 'alipay'
//   PlatformEnv.device()   → 'pc' | 'mobile' | 'tablet'
//   PlatformEnv.isTouch()  → 是否触屏设备
//   PlatformEnv.isMobile() → 手机/平板（true = 启用触控 UI、特效降级）
//   PlatformEnv.channel()  → 渠道标识（分享链接带 ?channel=xxx）
//
// 说明：
//   - 微信内置浏览器打开 H5 → runtime 仍是 'web'（只有小游戏宿主才是
//     'wechat'，才走 wx.login；H5 内没有 wx API，走游客/常规登录）
//   - 检测结果进程内缓存，首次调用后零开销
// ============================================================

const PlatformEnv = {
    _cache: null,

    // 一次性检测（结果缓存）
    detect() {
        if (this._cache) return this._cache;
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const hasTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
                         (typeof window !== 'undefined' && 'ontouchstart' in window);

        // ① 运行环境：小程序/小游戏宿主 API 判定（各宿主全局对象不同）
        let runtime = 'web';
        if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
            runtime = 'wechat';           // 微信小游戏/小程序宿主
        } else if (typeof tt !== 'undefined' && typeof tt.getSystemInfoSync === 'function') {
            runtime = 'douyin';           // 抖音小游戏宿主
        } else if (typeof my !== 'undefined' && typeof my.getSystemInfo === 'function') {
            runtime = 'alipay';           // 支付宝小程序宿主
        }

        // ② 设备形态：UA 优先；iPadOS 13+ 伪装 Mac 用多点触控识别
        let device = 'pc';
        if (/iPad/i.test(ua)) {
            device = 'tablet';
        } else if (/Macintosh/i.test(ua) &&
                   typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
            device = 'tablet';            // iPadOS 伪装 Mac 的特征
        } else if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) {
            device = 'mobile';
        }

        // ③ 渠道来源：URL ?channel= 参数（file:// 或无 location 环境 → direct）
        let channel = 'direct';
        try {
            const q = new URLSearchParams(
                (typeof location !== 'undefined' && location.search) || '');
            const c = q.get('channel');
            if (c) channel = String(c).slice(0, 32);
        } catch (e) { /* URLSearchParams 不可用（老宿主）→ direct */ }

        this._cache = { runtime, device, isTouch: hasTouch, channel, ua };
        return this._cache;
    },

    runtime() { return this.detect().runtime; },
    device() { return this.detect().device; },
    isTouch() { return this.detect().isTouch; },
    isMobile() { return this.detect().device !== 'pc'; },
    channel() { return this.detect().channel; },
};

// 导出全局（Node 测试 / 小程序环境同样可用；微信小游戏如无 globalThis 可换 GameGlobal）
globalThis.PlatformEnv = PlatformEnv;
