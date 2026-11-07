// ============================================================
// verify_user.js — user.js 用户适配层无头验证
// 运行：node .codebuddy/verify/verify_user.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let PASS = 0, FAIL = 0;
function T(name, cond) {
    if (cond) { PASS++; console.log(`  PASS  ${name}`); }
    else { FAIL++; console.log(`  FAIL  ${name}`); }
}

// localStorage mock（Web 存储语义：值一律 String 化，不存在返回 null）
function makeStorage(preset) {
    const m = new Map(Object.entries(preset || {}));
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
    };
}

const envSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'fn-js', 'env.js'), 'utf8');
const userSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'fn-js', 'user.js'), 'utf8');

// 在全新 vm 上下文加载 env.js + user.js（模拟一次"页面启动"，底部自动 UserAuth.init()）
function boot(storage, promptImpl, extraGlobals) {
    const ctx = {
        console: { log: () => {}, warn: () => {} },
        localStorage: storage,
        prompt: promptImpl || (() => null),
        Date, Math, JSON, Promise, String, Number, setTimeout,
        URLSearchParams,   // 浏览器有、vm 隔离上下文没有 → mock 补齐（P9 渠道解析依赖）
        ...(extraGlobals || {}),
    };
    vm.createContext(ctx);
    vm.runInContext(envSrc, ctx);
    vm.runInContext(userSrc, ctx);
    return ctx;
}

console.log('==== user.js 用户适配层验证 ====');

// --- A: 游客自动初始化 ---
const storeA = makeStorage();
const ctxA = boot(storeA);
const ua = ctxA.UserAuth;
const userA = ua.get();
T('A1: 脚本加载自动 init，用户存在', !!userA);
T('A2: 游客身份', userA.isGuest === true && ua.isGuest() === true);
T('A3: 平台标识 web', userA.platform === 'web');
T('A4: uid 为 guest 前缀', typeof userA.uid === 'string' && userA.uid.startsWith('guest_'));
T('A5: 默认昵称 玩家', userA.name === '玩家');
T('A6: 游客不算已登录', ua.isLoggedIn() === false);

// --- B: init 幂等（同一会话重复调用身份不变）---
const uid1 = userA.uid;
ua.init();
T('B: init 幂等，uid 不变', ua.get().uid === uid1);

// --- C/D: KV 通道 ---
ua.saveKV('test_k', '42');
T('C1: saveKV/loadKV roundtrip', ua.loadKV('test_k', '0') === '42');
T('C2: KV 真实落到底层存储（String 语义）', storeA.getItem('test_k') === '42');
T('D: loadKV 不存在键返回 fallback', ua.loadKV('nope', 'def') === 'def');

// --- E: requestProfile（Web 行内改名）---
const storeE = makeStorage();
const ctxE = boot(storeE, () => '  小猪快跑  ');
ctxE.UserAuth.requestProfile().then(() => {
    T('E1: requestProfile 改名并 trim', ctxE.UserAuth.get().name === '小猪快跑');
    const saved = JSON.parse(storeE.getItem('gameSecond_user_v1'));
    T('E2: 改名已持久化到身份存储', saved && saved.name === '小猪快跑');
});

const storeE2 = makeStorage();
const ctxE2 = boot(storeE2, () => '一二三四五六七八九十甲乙丙丁');   // 14 字
ctxE2.UserAuth.requestProfile().then(() => {
    T('E3: 昵称超长截断至 12 字', ctxE2.UserAuth.get().name.length === 12);
});

// --- G: requestProfile 取消（prompt 返回 null）→ 不改名 ---
const storeG = makeStorage();
const ctxG = boot(storeG, () => null);
ctxG.UserAuth.requestProfile().then(() => {
    T('G: 取消输入不改名', ctxG.UserAuth.get().name === '玩家');
});

// --- F: 身份数据损坏 → 安全重建游客 ---
const storeF = makeStorage({ 'gameSecond_user_v1': '{broken json!!' });
const ctxF = boot(storeF);
T('F: 身份数据损坏时安全重建游客', ctxF.UserAuth.get().isGuest === true &&
    ctxF.UserAuth.get().uid.startsWith('guest_'));

// --- H: 跨会话身份恢复（同一存储重新"启动"）---
const storeH = makeStorage();
const uidH = boot(storeH).UserAuth.get().uid;
const uidH2 = boot(storeH).UserAuth.get().uid;   // 模拟刷新页面后再启动
T('H: 跨会话 uid 稳定恢复', uidH2 === uidH);

// --- P: 终端检测 PlatformEnv（端识别）---
// P1: Windows PC 浏览器
const pc = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0', maxTouchPoints: 0 },
      location: { search: '' } });
T('P1: Windows Chrome 识别为 web/pc',
    pc.PlatformEnv.runtime() === 'web' && pc.PlatformEnv.device() === 'pc' && pc.PlatformEnv.isMobile() === false);
// P2: Android 手机
const and = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Chrome/120.0', maxTouchPoints: 5 } });
T('P2: Android 识别为 mobile + 触屏', and.PlatformEnv.device() === 'mobile' && and.PlatformEnv.isTouch() === true);
// P3: iPhone
const ios = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari', maxTouchPoints: 5 } });
T('P3: iPhone 识别为 mobile', ios.PlatformEnv.device() === 'mobile');
// P4: iPad + iPadOS 伪装 Mac
const ipad = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', maxTouchPoints: 5 } });
T('P4: iPad 识别为 tablet', ipad.PlatformEnv.device() === 'tablet');
const ipadMac = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', maxTouchPoints: 5 } });
T('P4b: iPadOS 伪装 Mac 识别为 tablet', ipadMac.PlatformEnv.device() === 'tablet');
// P5: 微信内置浏览器打开 H5 → runtime 仍是 web（小游戏宿主才有 wx API）
const wxh5 = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) MicroMessenger/8.0.49', maxTouchPoints: 5 } });
T('P5: 微信 H5 = web 运行时 + mobile 设备', wxh5.PlatformEnv.runtime() === 'web' && wxh5.PlatformEnv.device() === 'mobile');
// P6: 微信小游戏宿主
const wxmg = boot(makeStorage(), null, { wx: { getSystemInfoSync: () => ({ platform: 'ios' }), login: () => {} } });
T('P6: wx 宿主识别为 wechat', wxmg.PlatformEnv.runtime() === 'wechat');
// P7/P8: 抖音 / 支付宝宿主
const ttmg = boot(makeStorage(), null, { tt: { getSystemInfoSync: () => ({}) } });
T('P7: tt 宿主识别为 douyin', ttmg.PlatformEnv.runtime() === 'douyin');
const mym = boot(makeStorage(), null, { my: { getSystemInfo: () => ({}) } });
T('P8: my 宿主识别为 alipay', mym.PlatformEnv.runtime() === 'alipay');
// P9/P10: 渠道参数
const ch = boot(makeStorage(), null, { location: { search: '?channel=friend_share&x=1' } });
T('P9: URL 渠道参数解析', ch.PlatformEnv.channel() === 'friend_share');
T('P10: 无参数默认 direct', boot(makeStorage()).PlatformEnv.channel() === 'direct');
// P11: 检测结果缓存（同上下文多次调用同一对象）
const c1 = pc.PlatformEnv.detect(), c2 = pc.PlatformEnv.detect();
T('P11: 检测结果缓存复用', c1 === c2);
// P12: 微信小游戏环境未注册适配器 → 回退游客不崩溃
T('P12: wechat 宿主未注册适配器回退游客', wxmg.UserAuth.get() !== null && wxmg.UserAuth.get().isGuest === true);
// P13: 移动浏览器 UserAuth 正常初始化（环境层与身份层联动）
const mob = boot(makeStorage(), null,
    { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13) Mobile Chrome/120.0', maxTouchPoints: 5 } });
T('P13: 移动端浏览器正常初始化游客', mob.UserAuth.get().isGuest === true);

// --- 总结（等全部微任务断言跑完）---
setTimeout(() => {
    console.log('====');
    console.log(`结果: ${PASS} PASS / ${FAIL} FAIL`);
    process.exit(FAIL ? 1 : 0);
}, 50);
