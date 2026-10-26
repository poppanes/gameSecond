// ============================================
// C 阶段：8-bit 音效系统（Web Audio 程序合成，零素材依赖）
// ============================================
// 撤回保障（三重）：
//   1. 独立提交：git revert 本提交即可整体回退
//   2. 运行时开关：AUDIO_CONFIG.enabled = false（静音，不改代码）
//   3. 调用点 typeof 防御：删除本文件游戏也不崩（所有调用形如 if (typeof Sfx !== 'undefined') Sfx.play('xx')）
//
// 音色风格：芯片音（方波/锯齿/三角波 + 快速衰减包络 + 白噪声），全部程序合成
// 事件接入：翻转/反转/拾取/击晕/受伤/死亡/爆炸/传送/菜单/通关/失败

// 运行时配置（enabled=false 即全局静音）
const AUDIO_CONFIG = {
    enabled: true,   // 音效总开关
    volume: 0.3,     // 主音量（0~1）
};

// 事件音色表（单一数据源：增删音效只改这张表）
// type: square(方波主音色)/sawtooth(锯齿)/triangle(三角)；seq = 琶音序列；type:'noise' = 白噪声爆发
const SFX_DEFS = {
    flip:     { type: 'square',   freq: 440,  endFreq: 660,  dur: 0.08, vol: 0.5 },  // 翻板：上扬短哔
    flipBack: { type: 'square',   freq: 660,  endFreq: 440,  dur: 0.08, vol: 0.5 },  // 反转：下行
    pickup:   { type: 'square',   freq: 523,  endFreq: 1046, dur: 0.12, vol: 0.5 },  // 拾取：上扬
    stun:     { type: 'square',   freq: 220,  endFreq: 110,  dur: 0.12, vol: 0.6 },  // 击晕：低频下坠
    hurt:     { type: 'sawtooth', freq: 300,  endFreq: 80,   dur: 0.2,  vol: 0.6 },  // 受伤：锯齿骤降
    death:    { type: 'sawtooth', freq: 400,  endFreq: 40,   dur: 0.6,  vol: 0.7 },  // 死亡：长下降
    explode:  { type: 'noise',    dur: 0.3,   vol: 0.7 },                             // 爆炸：白噪声
    portal:   { type: 'triangle', freq: 200,  endFreq: 1200, dur: 0.18, vol: 0.5 },  // 传送：科幻上滑
    menu:     { type: 'square',   freq: 880,  endFreq: 880,  dur: 0.05, vol: 0.4 },  // 菜单光标：短哔
    confirm:  { type: 'square',   freq: 660,  endFreq: 990,  dur: 0.1,  vol: 0.5 },  // 确认：上扬双音感
    clear:    { type: 'square',   seq: [523, 659, 784, 1046], dur: 0.12, vol: 0.6 },  // 通关：上扬琶音
    gameover: { type: 'square',   seq: [440, 349, 294, 220],  dur: 0.18, vol: 0.6 },  // 失败：下降琶音
    timeout:  { type: 'square',   seq: [392, 330, 262],       dur: 0.15, vol: 0.6 },  // 超时：三音下降
};

const Sfx = {
    _audioCtx: null,

    // 惰性获取 AudioContext（不存在/不支持 → null；suspended → resume 手势解锁）
    _ctx() {
        if (!AUDIO_CONFIG.enabled) return null;
        const AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
        if (!AC) return null;   // Node / 不支持环境：静默降级
        if (!this._audioCtx) this._audioCtx = new AC();
        if (this._audioCtx.state === 'suspended') this._audioCtx.resume();   // 移动端首次手势解锁
        return this._audioCtx;
    },

    // 播放事件音效（事件名见 SFX_DEFS；未知事件静默忽略）
    play(name) {
        const def = SFX_DEFS[name];
        if (!def) return;
        const ctx = this._ctx();
        if (!ctx) return;
        try {
            const t0 = ctx.currentTime;
            if (def.type === 'noise') {
                this._noise(ctx, def, t0);
            } else if (def.seq) {
                def.seq.forEach((f, i) => this._tone(ctx, def.type, f, f, def.dur, def.vol, t0 + i * def.dur));
            } else {
                this._tone(ctx, def.type, def.freq, def.endFreq || def.freq, def.dur, def.vol, t0);
            }
        } catch (e) { /* 音频异常不阻断游戏 */ }
    },

    // 单音（滑音：f0 → f1 指数过渡 + 快速衰减包络）
    _tone(ctx, type, f0, f1, dur, vol, t0) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(1, f0), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * AUDIO_CONFIG.volume, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur);
    },

    // 白噪声（爆炸）：随机采样 Buffer + 衰减包络
    _noise(ctx, def, t0) {
        const len = Math.floor(ctx.sampleRate * def.dur);
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(def.vol * AUDIO_CONFIG.volume, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + def.dur);
        src.connect(g).connect(ctx.destination);
        src.start(t0);
    },
};

// 首次交互解锁（移动端自动播放限制：任意按键/触摸时 resume）
if (typeof window !== 'undefined') {
    const unlockAudio = () => { if (Sfx._audioCtx && Sfx._audioCtx.state === 'suspended') Sfx._audioCtx.resume(); };
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
}
