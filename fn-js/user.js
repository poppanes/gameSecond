// ============================================================
// user.js — 用户身份 / 会话平台适配层
// ============================================================
// 【多平台上线策略】游戏逻辑只依赖统一的 User 对象与 UserAuth 门面，
// 各小程序平台（微信/抖音/支付宝…）的登录差异全部封装在各自适配器中。
//
// 登录形态（2026-10-16 与用户对齐）：
//   1. 游客模式（默认）：无登录直接玩，本地持久化身份与数据 —— 当前 Web 实现
//   2. 平台静默登录：wx.login / tt.login / my.getAuthCode → code 换 openid（无感）
//   3. 昵称头像按需授权：getUserProfile 等（用户主动点击，触发时机由游戏决定）
//
// 游戏侧唯一入口（游戏代码不要直接碰 localStorage / wx.storage）：
//   UserAuth.init()             — 启动初始化（本文件底部自动调用）
//   UserAuth.get()              — 当前用户 { uid, name, avatar, isGuest, platform }
//   UserAuth.isLoggedIn()       — 是否已登录非游客
//   UserAuth.isGuest()          — 是否游客
//   UserAuth.requestProfile()   — 按需获取昵称头像（Web=行内改名；微信=授权组件）
//   UserAuth.saveKV(k, v) / UserAuth.loadKV(k, def) — 平台无关持久化通道
//       （现有 HI-SCORE 'fn_hi'、关卡进度 'gameSecond_progress_v1'
//         迁移到该通道的时机 = 首个小程序接入阶段，届时一并切换）
// ============================================================

// ---------- 统一 User 结构 ----------
// {
//     uid:      'guest_xxx' | 'wx_oXXX',  // 平台内唯一 ID
//     name:     '玩家',                    // 展示昵称
//     avatar:   '',                       // 头像 URL（游客为空）
//     isGuest:  true,                     // 是否游客身份
//     platform: 'web',                    // 来源平台标识
// }

// ---------- 存储键名（统一前缀，避免与现有键冲突）----------
const USER_KEY = 'gameSecond_user_v1';

// ---------- UserAuth 门面 ----------
const UserAuth = {
    _adapters: null,     // 适配器注册表 { 'wechat': WechatAdapter, ... }
    _adapter: null,      // 当前生效适配器
    _user: null,

    // 注册平台适配器（可注册多个；init 时按 PlatformEnv.runtime() 自动路由）
    // 适配器 name 必须与 PlatformEnv.runtime() 返回值对齐：'wechat'/'douyin'/'alipay'
    register(adapter) {
        this._adapters = this._adapters || {};
        this._adapters[adapter.name] = adapter;
    },

    // 启动初始化：按运行环境选适配器 → 静默登录/恢复会话（幂等，可重复调用）
    init() {
        const env = (typeof PlatformEnv !== 'undefined')
            ? PlatformEnv.detect()
            : { runtime: 'web', device: 'pc', channel: 'direct' };   // env.js 未加载时兜底
        this._adapters = this._adapters || {};
        this._adapter = this._adapters[env.runtime] || WebGuestAdapter;
        if (env.runtime !== 'web' && this._adapter === WebGuestAdapter) {
            console.warn(`[User] 检测到 ${env.runtime} 环境但未注册对应适配器，回退游客身份`);
        }
        try {
            this._user = this._adapter.silentLogin();
        } catch (e) {
            console.warn('[User] 平台登录失败，回退游客身份', e);
            this._adapter = WebGuestAdapter;
            this._user = WebGuestAdapter.silentLogin();
        }
        const u = this._user;
        const ch = env.channel && env.channel !== 'direct' ? ` / 渠道 ${env.channel}` : '';
        console.log(`[User] 就绪: ${u.name}（${u.platform}${u.isGuest ? ' · 游客' : ''}）| 终端 ${env.device}/${env.runtime}${ch}`);
        return u;
    },

    get() { return this._user; },
    isLoggedIn() { return !!this._user && !this._user.isGuest; },
    isGuest() { return !!this._user && this._user.isGuest; },

    // 按需请求昵称/头像（各平台实现不同；Web 实现 = 行内改名）
    requestProfile() {
        if (!this._adapter || !this._user) return Promise.resolve(this._user);
        return Promise.resolve(this._adapter.requestProfile(this._user))
            .then(u => { this._user = u || this._user; return this._user; })
            .catch(e => { console.warn('[User] 获取资料失败', e); return this._user; });
    },

    // 平台无关 KV 持久化（未来分数/进度/云存档统一走这里）
    saveKV(key, value) { return this._adapter.saveKV(key, value); },
    loadKV(key, fallback) { return this._adapter.loadKV(key, fallback); },
};

// ---------- Web 游客适配器（当前默认实现）----------
const WebGuestAdapter = {
    name: 'web',

    // 恢复本地游客身份；无身份则创建（uid 稳定，刷新/重开不变化）
    silentLogin() {
        let u = null;
        try {
            const raw = localStorage.getItem(USER_KEY);
            if (raw) u = JSON.parse(raw);
        } catch (e) { u = null; }        // 身份数据损坏 → 当作无身份，安全重建
        if (!u || !u.uid) {
            u = {
                uid: 'guest_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                name: '玩家',
                avatar: '',
                isGuest: true,
                platform: 'web',
            };
        }
        u.platform = 'web';
        this._persist(u);
        return u;
    },

    // Web 游客"授权" = 行内改名（与平台接口同形：同步返回 user）
    requestProfile(user) {
        try {
            const name = prompt('给自己起个名字：', user.name || '玩家');
            if (name && name.trim()) {
                user.name = name.trim().slice(0, 12);
                this._persist(user);
            }
        } catch (e) { /* 无 prompt 环境（如 Node/小游戏）忽略 */ }
        return user;
    },

    saveKV(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) {} },
    loadKV(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (e) { return fallback; }
    },

    _persist(u) { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (e) {} },
};

// ---------- 微信小游戏适配器（占位桩：上线微信时实现并注册）----------
// 接入步骤：
//   1. 实现以下四个接口（wx API 均为异步，用 Promise 包装）
//   2. 平台入口：UserAuth.register(WechatAdapter) → UserAuth.init()
//      （name 必须为 'wechat'，与 PlatformEnv.runtime() 对齐，init 自动路由）
//   3. 静默登录建议配合微信云开发（免自建服务器）：
//      wx.login → code → 云函数 code2session → openid → uid = 'wx_' + openid
//      登录会话结果可存 wx.setStorageSync 复用，避免每次冷启动都调云函数
// const WechatAdapter = {
//     name: 'wechat',
//     silentLogin() { /* wx.login → 云函数换 openid */ },
//     // 昵称头像（2022 后规范）：button open-type="chooseAvatar" + input type="nickname"
//     requestProfile(user) { /* 弹授权组件，回填 user.name/avatar 并持久化 */ },
//     saveKV(key, value) { /* wx.setStorageSync(key, value) */ },
//     loadKV(key, fallback) { /* const v = wx.getStorageSync(key); return v === '' ? fallback : v; */ },
// };

// 启动即初始化（Web 游客恢复为纯本地同步操作，无网络请求）
UserAuth.init();

// 导出全局：游戏任意脚本可直接使用 UserAuth；Node 测试 / 小程序环境同样可用
// （微信小游戏环境若无 globalThis，可替换为 GameGlobal.UserAuth = UserAuth）
globalThis.UserAuth = UserAuth;
