// ============================================
// 电玩特效层（A 阶段）：浮动文字 + 全局爆裂粒子
// 纯程序绘制，零素材依赖；渲染入口在 game.render 末尾（HUD 之下）
// ============================================

// ---- 浮动文字（拾取加分 / 状态提示 飘字上浮）----
const floatTexts = [];

// col/row = 网格坐标；text = 显示文本；color = 主色
function spawnFloatText(col, row, text, color = '#ffd700') {
    floatTexts.push({
        col, row, text, color,
        born: performance.now(),
        life: 900,                                   // 存活 0.9s：上浮 + 渐隐
    });
}

function updateFloatTexts() {
    const now = performance.now();
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        if (now - floatTexts[i].born > floatTexts[i].life) floatTexts.splice(i, 1);
    }
}

function drawFloatTexts(ctx) {
    const now = performance.now();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px ' + (typeof ARCADE_FONT !== 'undefined' ? ARCADE_FONT : '"Press Start 2P", monospace');
    for (const ft of floatTexts) {
        const t = (now - ft.born) / ft.life;         // 0 → 1
        const x = OFFSET_X + ft.col * CELL_SIZE + CELL_SIZE / 2;
        const y = OFFSET_Y + ft.row * CELL_SIZE - 8 - t * 34;   // 上浮 34px
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;    // 后 30% 渐隐
        ctx.fillStyle = '#000';
        ctx.fillText(ft.text, x + 2, y + 2);         // 黑色投影（街机描边感）
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

// ---- 爆裂粒子（像素方块 + 轻重力，零素材）----
const bursts = [];

// col/row = 爆心网格坐标；colors = 颜色池；count = 粒子数
function spawnBurst(col, row, colors = ['#ffd700', '#ff8c00', '#ffffff'], count = 14) {
    const parts = [];
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.08 + Math.random() * 0.22;     // px/ms
        parts.push({
            x: 0, y: 0,                              // 相对爆心偏移
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 0.06,          // 略向上偏（爆开感）
            size: 3 + Math.random() * 4,
            color: colors[i % colors.length],
            life: 380 + Math.random() * 320,
        });
    }
    bursts.push({ col, row, parts, born: performance.now() });
}

function updateBursts(dt) {
    const now = performance.now();
    for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        if (now - b.born > 700) { bursts.splice(i, 1); continue; }
        for (const p of b.parts) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 0.0005 * dt;                     // 轻微重力
        }
    }
}

function drawBursts(ctx) {
    const now = performance.now();
    ctx.save();
    for (const b of bursts) {
        const age = now - b.born;
        const alpha = Math.max(0, 1 - age / 700);
        const bx = OFFSET_X + b.col * CELL_SIZE + CELL_SIZE / 2;
        const by = OFFSET_Y + b.row * CELL_SIZE + CELL_SIZE / 2;
        for (const p of b.parts) {
            if (age > p.life) continue;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            const s = p.size * (1 - age / 900);
            ctx.fillRect(bx + p.x - s / 2, by + p.y - s / 2, s, s);   // 像素方块粒子
        }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}
