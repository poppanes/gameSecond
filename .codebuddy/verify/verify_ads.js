// ============================================================
// verify_ads.js — ads.js 广告抽象层无头验证
// 运行：node .codebuddy/verify/verify_ads.js
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

function makeStorage() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
    };
}

const envSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'fn-js', 'env.js'), 'utf8');
const adsSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'fn-js', 'ads.js'), 'utf8');

// 全新 vm 上下文加载 env.js + ads.js（底部自动 AdManager.init()）
function boot(extraGlobals) {
    const ctx = {
        console: { log: () => {}, warn: () => {} },
        localStorage: makeStorage(),
        Date, Math, JSON, Promise, String, Number, setTimeout,
        ...(extraGlobals || {}),
    };
    vm.createContext(ctx);
    vm.runInContext(envSrc, ctx);
    vm.runInContext(adsSrc, ctx);
    return ctx;
}

console.log('==== ads.js 广告抽象层验证 ====');

// --- Q1: Web 环境默认 Mock ---
const web = boot();
T('Q1: Web 环境默认 Mock 提供者', web.AdManager._provider.name === 'web');

// --- Q2: 开发模式激励视频回调链（立即发奖）---
let q2Reward = false, q2Done = null;
web.AdManager.showRewarded('revive', () => { q2Reward = true; }, ok => { q2Done = ok; });
T('Q2: Mock 激励视频 onReward + onDone(true) 同步回调', q2Reward === true && q2Done === true);

// --- Q3: 开发模式 isReady 恒可用（入口可见、流程可测）---
T('Q3: 开发模式 isReady 恒 true', web.AdManager.isReady('rewarded') === true);

// --- Q4: 插屏频控 ---
const first = web.AdManager.showInterstitial('level_gap');
const second = web.AdManager.showInterstitial('level_gap');
T('Q4: 插屏首次可播、立即第二次被频控拦截', first === true && second === false);

// --- Q5: 频控间隔过后恢复 ---
web.AdManager._lastInterstitial = Date.now() - 61000;   // 拨回 61s 前
T('Q5: 间隔过后插屏恢复可播', web.AdManager.showInterstitial('level_gap') === true);

// --- Q6: 平台路由（抖音宿主 + 注册 provider）---
const dy = boot({ tt: { getSystemInfoSync: () => ({}) } });
const dyCalls = [];
dy.AdManager.register({
    name: 'douyin',
    showRewarded: (p, r, d) => { dyCalls.push(p); r && r(); d && d(true); return true; },
});
dy.AdManager.init();
T('Q6: 抖音宿主自动路由到注册的 provider', dy.AdManager._provider.name === 'douyin');

// --- Q7: enabled=true 后激励视频走平台 provider（placement 透传）---
vm.runInContext('AD_CONFIG.enabled = true;', dy);   // const 词法声明，需在上下文内修改
let q7Done = null;
dy.AdManager.showRewarded('double_score', () => {}, ok => { q7Done = ok; });
T('Q7: 启用后走平台 provider 且 placement 透传',
    dyCalls.includes('double_score') === true && q7Done === true);

// --- Q8: 广告拉取/观看失败 → onDone(false) 且不触发 onReward ---
dy.AdManager.register({
    name: 'douyin',
    showRewarded: (p, r, d) => { d && d(false); return false; },   // 模拟失败
});
dy.AdManager.init();
let q8Reward = false, q8Done = null;
dy.AdManager.showRewarded('revive', () => { q8Reward = true; }, ok => { q8Done = ok; });
T('Q8: 失败场景不发奖（onReward 不触发、onDone(false)）', q8Reward === false && q8Done === false);

// --- Q9: 横幅 show/hide ---
T('Q9: 横幅 showBanner 返回成功', web.AdManager.showBanner('menu_banner') === true);

// --- Q10: 频控只作用于插屏（激励视频不受插屏频控影响）---
const web2 = boot();
web2.AdManager.showInterstitial('level_gap');              // 触发频控
let q10 = false;
web2.AdManager.showRewarded('revive', () => { q10 = true; });
T('Q10: 激励视频不受插屏频控影响', q10 === true);

// --- 总结 ---
console.log('====');
console.log(`结果: ${PASS} PASS / ${FAIL} FAIL`);
process.exit(FAIL ? 1 : 0);
