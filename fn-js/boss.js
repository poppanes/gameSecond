// ============================================
// BOSS 关卡：幽灵王（B1 骨架：素材帧表 + 波浪飞行 + 受击 + 血量）
// ============================================
// 单独调参文件：所有数值集中在 BOSS_CONFIG，方便后续修改
// 素材：fn-image/boss/*.png（6 张 1080×608 帧表图，行优先序列）

const BOSS_CONFIG = {
    maxHp: 100,             // BOSS 血量
    hurtFlashMs: 1500,      // BOSS 受击闪烁时间
    hurtStopMs: 1500,       // BOSS 受击停止移动时间
    flipInterval: 20000,    // 翻转间隔 20s（B2 接入：两行/两列翻转）
    flipWarnMs: 1000,       // 翻转预警时长（红色闪烁提示，给玩家躲避窗口）
    spawnInterval: 15000,   // 释放小怪间隔 15s（B2 接入：空中丢下）
    moveSpeed: 7,           // 移动速度（px/帧@60fps，可配置，用户调参）
    scale: 0.75,            // 绘制缩放（帧 270×304 → 约 202×228，用户调参）
    waveAmp: 150,           // 波浪振幅（px，用户调参）
    wavePeriod: 1500,       // 波浪周期（ms，用户调参）
    roundTime: 500000,      // 对局 500 秒
    spawnAnimMs: 800,       // 释放动作动画时长（播完才落小怪）
    hitDamage: 50,          // 投掷小怪命中 BOSS 的掉血量（用户调参）
    maxMinions: 8,          // 场上驻守小怪上限（满员不再释放——防积累占满全图）
    turnBeyondCells: 5,     // 出图后继续飞出的格数（折返点）
    debugLog: true,         // 诊断日志开关（临时开启）
};

// 帧表构建：行优先序列（行 0 帧 0..cols-1 → 行 1 帧 cols..）
function buildBossFrames(img, cols, rows) {
    const fw = img.width / cols, fh = img.height / rows;
    const frames = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        frames.push({ x: c * fw, y: r * fh, w: fw, h: fh });
    }
    return frames;
}

// death 素材（boss_death1.png 1280×720）精灵为非均匀排布（透视缩小：逐帧变小、间距递减），
// 按等分网格裁剪会串帧（帧右缘被切、下一帧左缘带残影）。
// 以下为逐帧实测包围盒导出的自定义帧窗口：统一 240×330，上排 y=0 / 下排 y=300，底部对齐，
// 保证死亡缩小消失过程位置稳定、无残影无切边。
const DEATH_FRAMES = [
    { x: 40,   y: 0,   w: 240, h: 330 },   // 上排 1（精灵 x39-282）
    { x: 324,  y: 0,   w: 240, h: 330 },   // 上排 2（332-557）
    { x: 587,  y: 0,   w: 240, h: 330 },   // 上排 3（604-811）
    { x: 831,  y: 0,   w: 240, h: 330 },   // 上排 4（859-1043）
    { x: 1040, y: 0,   w: 240, h: 330 },   // 上排 5（1092-1246）
    { x: 42,   y: 300, w: 240, h: 330 },   // 下排 1（86-239）
    { x: 306,  y: 300, w: 240, h: 330 },   // 下排 2（358-495）
    { x: 574,  y: 300, w: 240, h: 330 },   // 下排 3（634-754）
    { x: 839,  y: 300, w: 240, h: 330 },   // 下排 4（911-1007）
    { x: 1040, y: 300, w: 240, h: 330 },   // 下排 5（1128-1206 消散碎片）
];

class BossKing {
    constructor() {
        this.hp = BOSS_CONFIG.maxHp;
        this.maxHp = BOSS_CONFIG.maxHp;
        this.hurtTimer = 0;                    // 受击（闪烁+停止移动）剩余
        this.flipTimer = BOSS_CONFIG.flipInterval;
        this.flipWarn = null;                  // 翻转预警 { cells, timer }——倒计时结束才真正翻转
        this.spawnTimer = BOSS_CONFIG.spawnInterval;
        this.spawnAnim = 0;                    // 释放动作动画剩余
        this.deathAnim = 0;                    // 死亡动画时钟（dying 播放，播完 dead）
        this._lockedCell = null;               // 释放格锁定（spawnTimer 触发时锁定 BOSS 所在格）
        this.animClock = 0;                    // 飞行帧时钟
        this.state = 'active';                 // active/hurt/spawn/dying/dead
        // 波浪飞行：px 横向匀速（出图后从另一侧回来），py = 基线 + sin 抛物线
        this.px = OFFSET_X + GRID_WIDTH + CELL_SIZE * 1.5;   // 从地图右侧外飞入
        this.py = OFFSET_Y + 100;
        this.baseY = OFFSET_Y + 100;
        this.dir = -1;                         // 初始从右往左
        this.speed = BOSS_CONFIG.moveSpeed;
        this.waveT = 0;
        this._leftTouched = false;             // [LOG] 左缘触碰打点标志
        // 素材加载（onload 后帧表就绪）
        this.sheets = {};
        const defs = [
            ['fly', '../fn-image/boss/boss_fly1.png', 4, 2],
            ['spawn', '../fn-image/boss/boss_spawn1.png', 5, 2],
            ['hurt', '../fn-image/boss/boss_hurt1.png', 3, 2],
            ['death', '../fn-image/boss/boss_death1.png', 5, 2],
        ];
        defs.forEach(([key, src, cols, rows]) => {
            const img = new Image();
            this.sheets[key] = null;   // onload 前占位（draw 空判跳过）
            img.onload = () => {
                // death 素材精灵非均匀排布 → 用实测自定义帧窗口；其余按网格等分
                const frames = key === 'death' ? DEATH_FRAMES : buildBossFrames(img, cols, rows);
                // 白色剪影版（受击频闪用：只染精灵本体轮廓，不出现方块罩）
                const white = BossKing.makeWhiteSilhouette(img);
                this.sheets[key] = { img, white, frames };
            };
            img.src = src;
        });
    }

    // 离屏生成白色剪影：原 alpha 通道保留，颜色全部染白（用于受击闪烁）
    static makeWhiteSilhouette(img) {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const c = cv.getContext('2d');
        c.drawImage(img, 0, 0);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = '#fff';
        c.fillRect(0, 0, cv.width, cv.height);
        return cv;
    }

    update(dt) {
        this.animClock += dt;
        // 死亡演出：death 素材帧序播放（10 帧 1.2s），播完 → dead 通知胜利
        if (this.state === 'dying') {
            this.flipWarn = null;   // 死亡时取消未兑现的翻转预警
            this.deathAnim += dt;
            if (this.deathAnim >= 1200) this.state = 'dead';
            return;
        }
        if (this.state === 'dead') { this.flipWarn = null; return; }
        // 翻转预警倒计时：任何活动状态（含受击/释放）都推进，确保预警必兑现
        if (this.flipWarn) {
            this.flipWarn.timer -= dt;
            if (this.flipWarn.timer <= 0) {
                this._executeFlip(this.flipWarn.cells);
                this.flipWarn = null;
            }
        }
        // 受击：闪烁 + 停止移动 1.5s
        if (this.state === 'hurt') {
            this.hurtTimer -= dt;
            if (this.hurtTimer <= 0) this.state = 'active';
            return;
        }
        // 释放动作：播 spawn 动画（停止移动），播完空降小怪
        if (this.state === 'spawn') {
            this.spawnAnim -= dt;
            if (this.spawnAnim <= 0) { this._dropMinion(); this.state = 'active'; }
            return;
        }
        if (this.state !== 'active') return;
        // 波浪飞行：横向匀速（出图后从另一侧回来）+ 纵向 sin 抛物线
        this.px += this.dir * this.speed * (dt / 16);
        this.waveT += dt;
        this.py = this.baseY + Math.sin(this.waveT / BOSS_CONFIG.wavePeriod * Math.PI * 2) * BOSS_CONFIG.waveAmp;
        // 出图折返：左出 → 从左侧重新进场反向飞右；右出 → 从右侧重新进场反向飞左
        // [LOG] 触碰左缘打点（一次性；反向重置）——诊断左侧是否穿出
        if (this.dir < 0 && !this._leftTouched && this.px < OFFSET_X) {
            this._leftTouched = true;
            if (BOSS_CONFIG.debugLog) console.log('[Boss][LOG] 触碰左缘 dir=' + this.dir + '：px=' + Math.round(this.px) + ' py=' + Math.round(this.py) + '，图外偏移 ' + Math.round(OFFSET_X - this.px) + 'px——继续飞行，完全出图后折返');
        }
        if (this.dir >= 0) this._leftTouched = false;
        if (this.dir < 0 && this.px < OFFSET_X - CELL_SIZE * BOSS_CONFIG.turnBeyondCells) {
            if (BOSS_CONFIG.debugLog) console.log('[Boss][LOG] 左缘折返触发 dir=' + this.dir + '：px=' + Math.round(this.px) + ' → 反向从左侧向右飞');
            this.dir = 1;
        }
        if (this.dir > 0 && this.px > OFFSET_X + GRID_WIDTH + CELL_SIZE * BOSS_CONFIG.turnBeyondCells) {
            if (BOSS_CONFIG.debugLog) console.log('[Boss][LOG] 右缘折返触发 dir=' + this.dir + '：px=' + Math.round(this.px) + ' → 反向从右侧向左飞');
            this.dir = -1;
        }
        // B2：翻转计时（20s 两行或两列，玩家在白格上受伤）
        this.flipTimer -= dt;
        if (this.flipTimer <= 0) { this._doFlip(); this.flipTimer = BOSS_CONFIG.flipInterval; }
        // B2：释放小怪计时（15s——先锁定 BOSS 所在格，播释放动画，播完空降）
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            const bcx = this.px + (270 * BOSS_CONFIG.scale) / 2;
            const bcy = this.py + (304 * BOSS_CONFIG.scale) / 2;
            const mx = bcx - OFFSET_X, my = bcy - OFFSET_Y;
            const raw = this._rawCell();   // BOSS 中心所在格（未 clamp）
            // 中心未深入图内 0.5 格（含完全出图/贴边）→ 挂起（飞回图内深处后下一帧自动触发）
            const inField = raw.col >= 0 && raw.col < COLS && raw.row >= 0 && raw.row < ROWS &&
                mx >= CELL_SIZE * 0.5 && my >= CELL_SIZE * 0.5 &&
                mx <= GRID_WIDTH - CELL_SIZE * 0.5 && my <= GRID_HEIGHT - CELL_SIZE * 0.5;
            if (!inField) return;
            // 场上小怪已达峰值 → 释放技能不触发（连释放动画都不播）；重置计时，数量回落后自动恢复
            const aliveMinions = enemies.filter(e => e instanceof BossMinion && e.alive && !e.carried).length;
            if (aliveMinions >= BOSS_CONFIG.maxMinions) {
                this.spawnTimer = BOSS_CONFIG.spawnInterval;
                return;
            }
            this._lockedCell = raw;   // 锁定 BOSS 当前所在格（必为图内合法格）
            this.state = 'spawn';
            this.spawnAnim = BOSS_CONFIG.spawnAnimMs;
            this.spawnTimer = BOSS_CONFIG.spawnInterval;
        }
    }

    // B2+：翻转改为两段式——先选定两行/两列红色闪烁预警 1.5s，倒计时结束才真正执行翻转（给玩家躲避窗口）
    _doFlip() {
        if (!map) return;
        const cells = [];
        if (Math.random() < 0.5) {
            const c1 = Math.floor(Math.random() * COLS);
            let c2 = Math.floor(Math.random() * COLS);
            while (c2 === c1) c2 = Math.floor(Math.random() * COLS);
            for (let r = 0; r < ROWS; r++) { cells.push([c1, r]); cells.push([c2, r]); }
        } else {
            const r1 = Math.floor(Math.random() * ROWS);
            let r2 = Math.floor(Math.random() * ROWS);
            while (r2 === r1) r2 = Math.floor(Math.random() * ROWS);
            for (let c = 0; c < COLS; c++) { cells.push([c, r1]); cells.push([c, r2]); }
        }
        this.flipWarn = { cells, timer: BOSS_CONFIG.flipWarnMs };
        if (typeof Sfx !== 'undefined') Sfx.play('bossFlip');   // 预警音效提前到预警开始时提示
        console.log('[Boss][LOG] 翻转预警 ' + (BOSS_CONFIG.flipWarnMs / 1000) + 's（' + cells.length + ' 格，行列见执行日志）');
    }

    // 预警结束：真正执行翻转（双向切换：原色→灰 / 已翻转→翻回原色；玩家站在被翻的格上受伤）
    _executeFlip(cells) {
        if (!map) return;
        let hitPlayer = false;
        cells.forEach(([c, r]) => {
            const t = map.tiles[r] && map.tiles[r][c];
            if (!t) return;
            const wasFlipped = t.color !== map.cellColor;   // 已翻转过？
            const fromColor = t.color, fromBorder = t.borderColor;
            // 双向切换：已翻转的格子翻回原色，未翻转的正常翻转（相反翻转）
            t.color = wasFlipped ? map.cellColor : map.flippedColor;
            t.borderColor = wasFlipped ? map.borderColor : map.flippedBorderColor;
            t.flipped = !wasFlipped;
            addFlipAnimation(c, r, fromColor, fromBorder, t.color, t.borderColor);
            if (player && !player.dying && player.gridX === c && player.gridY === r) hitPlayer = true;
        });
        if (hitPlayer && player && !player.dying) player.takeDamage(1);
        console.log('[Boss][LOG] 幽灵王翻转执行（' + cells.length + ' 格，双向切换）');
    }


    // BOSS 中心所在格（未 clamp——用于地图内/外判定）
    _rawCell() {
        const bcx = this.px + (270 * BOSS_CONFIG.scale) / 2;
        const bcy = this.py + (304 * BOSS_CONFIG.scale) / 2;
        return { col: Math.round((bcx - OFFSET_X) / CELL_SIZE), row: Math.round((bcy - OFFSET_Y) / CELL_SIZE) };
    }

    // BOSS 中心所在格（clamp 图内——兜底用）
    _currentCell() {
        const raw = this._rawCell();
        return { col: Math.max(0, Math.min(COLS - 1, raw.col)), row: Math.max(0, Math.min(ROWS - 1, raw.row)) };
    }

    // B2/B3：空降小怪——生成在「锁定的释放格」上（BOSS 在哪个格子释放，小怪就生成在那个格子，格中心对齐）
    _dropMinion() {
        const cell = this._lockedCell || this._currentCell();   // 兜底：未锁定时取当前格
        let col = Math.max(0, Math.min(COLS - 1, cell.col));   // 双保险：释放格永在图内（需求 3——地图外不放怪）
        let row = Math.max(0, Math.min(ROWS - 1, cell.row));
        // 驻守小怪上限：满员不再释放（防无限积累占满全图——空降点被占的根源）
        const aliveMinions = enemies.filter(e => e instanceof BossMinion && e.alive && !e.carried).length;
        if (aliveMinions >= BOSS_CONFIG.maxMinions) { console.log('[Boss] 驻守小怪已满（' + aliveMinions + '），本次跳过'); return; }
        // 锁定格被占 → 邻近环搜索可用格（距离 1~3，不再直接放弃释放）
        if (_isCellBlocked(col, row)) {
            let alt = null;
            outer: for (let d = 1; d <= 3; d++) {
                for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
                    if (Math.abs(c - col) + Math.abs(r - row) !== d) continue;
                    if (!_isCellBlocked(c, r)) { alt = { col: c, row: r }; break outer; }
                }
            }
            if (!alt) { console.log('[Boss] 无可用空降点，本次跳过'); return; }
            col = alt.col; row = alt.row;
            console.log('[Boss][LOG] 锁定格被占 → 邻近空格 (' + col + ',' + row + ')');
        }
        const m = new BossMinion(col, row);
        // [优化] 移除落地无敌：生成即 active，可被玩家踩翻/击杀（原 2000ms 预警=无敌豁免）
        m.alive = true; m.warning = 0; m.stunned = 0; m.flying = false; m.carried = false;
        m.pixelX = OFFSET_X + col * CELL_SIZE + BORDER_WIDTH;   // 生成在锁定格的格中心（居中）
        m.pixelY = OFFSET_Y + row * CELL_SIZE + BORDER_WIDTH;
        m.targetPixelX = m.pixelX; m.targetPixelY = m.pixelY;
        m.gridX = col; m.gridY = row;
        enemies.push(m);
        console.log('[Boss][LOG] 释放小怪空降 (' + col + ',' + row + ')（锁定释放格）BOSS=' + Math.round(this.px) + ',' + Math.round(this.py) + ' msize=' + Math.round(m.size));
    }

    draw(ctx) {
        // 翻转预警：即将翻转的行列格子红色闪烁（200ms 周期），提前 1.5s 提示玩家躲避
        if (this.flipWarn) {
            const blink = Math.floor(performance.now() / 200) % 2 === 0;
            const alpha = blink ? 0.45 : 0.18;   // 常亮低透明 + 高亮闪烁交替，始终可见
            ctx.save();
            ctx.fillStyle = 'rgba(233, 69, 96, ' + alpha + ')';
            this.flipWarn.cells.forEach(([c, r]) => {
                ctx.fillRect(OFFSET_X + c * CELL_SIZE, OFFSET_Y + r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            });
            ctx.restore();
        }
        // dying/dead → death 死亡帧表（此前误用 fly 帧表，导致死亡帧序列不播放）
        const sheetKey = this.state === 'hurt' ? 'hurt'
            : (this.state === 'spawn' ? 'spawn'
            : (this.state === 'dying' || this.state === 'dead') ? 'death' : 'fly');
        // 死亡动画播完（dead）→ 直接删除，不再绘制残留帧
        if (this.state === 'dead') return;
        const sheet = this.sheets[sheetKey];
        if (!sheet) return;
        const frames = sheet.frames;
        let frame;
        if (this.state === 'dying' || this.state === 'dead') {
            // 死亡帧序：10 帧每帧 120ms 共 1.2s，播完停最后帧（deathAnim=0 时从第 0 帧起播）
            frame = frames[Math.min(frames.length - 1, Math.floor(this.deathAnim / 120))];
        } else {
            frame = frames[Math.floor(this.animClock / 120) % frames.length];
        }
        const w = frame.w * BOSS_CONFIG.scale, h = frame.h * BOSS_CONFIG.scale;
        ctx.drawImage(sheet.img, frame.x, frame.y, frame.w, frame.h, this.px, this.py, w, h);
        // 受击闪烁：白色剪影叠加，只频闪 BOSS 本体（原 fillRect 方块罩因帧窗口大于精灵而显得是超大方块）
        if (this.state === 'hurt' && sheet.white && Math.floor(this.hurtTimer / 100) % 2 === 0) {
            ctx.globalAlpha = 0.85;
            ctx.drawImage(sheet.white, frame.x, frame.y, frame.w, frame.h, this.px, this.py, w, h);
            ctx.globalAlpha = 1;
        }
    }

    // 血量条（BOSS 战顶部）
    drawHpBar(ctx) {
        if (this.state === 'dead') return;   // 死亡动画播完 → 血条一并移除
        // 格子血条：一个格子 10 点血量（满血亮红、已扣暗格）；文字取消，后续可替换素材
        const hpPerCell = 10;
        const cells = Math.ceil(this.maxHp / hpPerCell);
        const cw = 28, ch = 16, gap = 2;
        const w = cells * cw + (cells - 1) * gap;
        const x = (CANVAS_WIDTH - w) / 2, y = 108;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 2, y - 2, w + 4, ch + 4);
        for (let i = 0; i < cells; i++) {
            const filled = this.hp > i * hpPerCell;
            ctx.fillStyle = filled ? '#e94560' : 'rgba(255,255,255,0.12)';
            ctx.fillRect(x + i * (cw + gap), y, cw, ch);
        }
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, ch);
    }

    // 受击（被小怪丢中）：掉血 + 闪烁 + 停止移动；返回是否死亡（B4 接死亡演出）
    takeDamage(amount) {
        if (this.state !== 'active') return false;
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp <= 0) { this.state = 'dying'; return true; }
        this.state = 'hurt';
        this.hurtTimer = BOSS_CONFIG.hurtFlashMs;
        return false;
    }
}

// B3：BOSS 专属小怪（幽灵王释放）——换皮 Ghost（minion 素材）+ 两格联动翻转（灰→白）
class BossMinion extends Ghost {
    constructor(col, row) {
        super(col, row);
        this.name = 'BossMinion';
        this.minionSheets = {};
        [['walk', '../fn-image/boss/minion_walk1.png', 4, 2], ['stun', '../fn-image/boss/minion_stun1.png', 3, 2]].forEach(([k, src, cols, rows]) => {
            const img = new Image();
            this.minionSheets[k] = { img, cols, rows, loaded: false };
            img.onload = () => { this.minionSheets[k].loaded = true; };
            img.src = src;
        });
    }
    // B3 优化：BOSS 小怪行为重写
    //  1) 玩家存活 → 优先追击玩家（击杀优先，不再优先翻板）
    //  2) 玩家被击杀/不存在 → 才去翻转地板
    //  3) 翻转 = 当前格 + 同列或同行连续相邻格（两格联动）
    //  4) 落地无敌已在 _dropMinion 移除，生成即被击杀
    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;

        // 复活预警中：倒计时，不可行动
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }

        // 飞行中：移动交给基类
        if (this.flying) { super.update(dt); return; }

        // 被拾取中：跟随玩家
        if (this.carried) {
            this.gridX = player.gridX; this.gridY = player.gridY;
            this.pixelX = player.pixelX; this.pixelY = player.pixelY;
            return;
        }

        // 硬直中：暂停所有活动
        if (this.stunned > 0) { this.stunned = Math.max(0, this.stunned - dt); return; }

        // 被推期间禁用自主移动
        if (this.pushed > 0) { this.pushed = Math.max(0, this.pushed - dt); return; }

        if (this.moveCooldown > 0) this.moveCooldown = Math.max(0, this.moveCooldown - dt);

        // 滑行中（复用基类逻辑，加速阶段更快）
        if (this.isMoving) {
            const dx = this.targetPixelX - this.pixelX;
            const dy = this.targetPixelY - this.pixelY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.5) {
                this.pixelX = this.targetPixelX; this.pixelY = this.targetPixelY;
                this.isMoving = false; this._onArrive();
            } else {
                const spd = getBoostedSpeed(this.moveSpeed);
                const step = Math.min(spd * dt, dist);
                this.pixelX += (dx / dist) * step;
                this.pixelY += (dy / dist) * step;
            }
            return;
        }

        if (this.moveCooldown > 0) return;

        // 玩家是否仍可击杀（存活）
        const playerAlive = player && (typeof player.isDead !== 'function' || !player.isDead());

        if (playerAlive) {
            // 需求1：优先追击玩家（纯追玩家 BFS，不走翻板目标）
            const dir = Enemy.prototype.findPath.call(this);
            if (dir) {
                const st = this._resolveStep(dir.dx, dir.dy, true);
                const nx = st.col, ny = st.row;
                if ((map && map.hasBox(nx, ny)) || _isCellBlocked(nx, ny, this) || isBlackHole(nx, ny)) {
                    this._wanderRandomly();
                    return;
                }
                this.gridX = nx; this.gridY = ny;
                if (st.wrapped) {
                    this.pixelX = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
                    this.pixelY = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
                    this.targetPixelX = this.pixelX;
                    this.targetPixelY = this.pixelY;
                    this.isMoving = false;
                } else {
                    this.targetPixelX = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
                    this.targetPixelY = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
                    this.isMoving = true;
                }
                this.moveCooldown = getBoostedInterval(300);
                return;
            }
            // 与玩家同格或不可达：游荡避免罚站（同格碰撞由 game.js 每帧检测处理）
            this._wanderRandomly();
            return;
        }

        // 需求2：玩家已被击杀 → 翻转地板（连续两格，同列或同行）
        if (this._flipCurrentAndAdjacent()) {
            this.moveCooldown = getBoostedInterval(ENEMY_FLIP_DELAY) + 400;
            return;
        }
        // 无可翻格子 → 自由游荡
        this._wanderRandomly();
    }

    // 重写到达逻辑：追玩家途中只碰撞玩家，不主动翻脚下地板
    // （翻板仅在玩家死亡后由 _flipCurrentAndAdjacent 处理，符合"玩家被击杀后才去翻转"）
    _onArrive() {
        this.moveCooldown = getBoostedInterval(300);
        if (player && (typeof player.isDead !== 'function' || !player.isDead()) &&
            this.gridX === player.gridX && this.gridY === player.gridY) {
            this._hitPlayer();
        }
    }

    // 两格联动翻转：当前格 + 同列或同行连续相邻格（灰→白，干扰玩家通关）
    // 优先选择一个能翻到灰格的方向，确保"连续两个、同列或同行"都尽量生效
    _flipCurrentAndAdjacent() {
        if (!map) return false;
        // 候选方向：上/下/左/右（同列或同行连续两格）
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }
        for (const [dx, dy] of dirs) {
            let flippedAny = false;
            [[this.gridX, this.gridY], [this.gridX + dx, this.gridY + dy]].forEach(([c, r]) => {
                if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
                if (map.hasBox(c, r)) return;
                if (map.isTileFlipped(c, r)) {
                    const t = map.tiles[r][c];
                    addPendingFlip(c, r, t.color, t.borderColor, map.cellColor, map.borderColor, true, getBoostedInterval(ENEMY_FLIP_DELAY));
                    flippedAny = true;
                }
            });
            if (flippedAny) {
                console.log('[BossMinion] 两格联动翻转（' + (dx === 0 ? '同行' : '同列') + '）');
                return true;
            }
        }
        return false;
    }
    // 小怪素材绘制（行走/硬直帧表切换；未加载时回落 Ghost 素材）
    draw(ctx) {
        if (!this.alive) return;
        if (BOSS_CONFIG.debugLog && !this._drawLogged) {
            this._drawLogged = true;
            const sk = this.stunned > 0 ? 'stun' : 'walk';
            const sh = this.minionSheets[sk];
            console.log('[BossMinion][LOG] 首次绘制 (' + this.gridX + ',' + this.gridY + ') sheet=' + sk + ' loaded=' + (sh ? sh.loaded : 'NO-SHEET') + ' alive=' + this.alive);
        }
        const sheet = this.minionSheets[this.stunned > 0 ? 'stun' : 'walk'];
        if (!sheet || !sheet.loaded) { super.draw(ctx); return; }
        const f = Math.floor(performance.now() / 120) % (sheet.cols * sheet.rows);
        const fw = sheet.img.width / sheet.cols, fh = sheet.img.height / sheet.rows;
        const fx = (f % sheet.cols) * fw, fy = Math.floor(f / sheet.cols) * fh;
        ctx.drawImage(sheet.img, fx, fy, fw, fh, this.pixelX, this.pixelY, CELL_SIZE - BORDER_WIDTH * 2, CELL_SIZE - BORDER_WIDTH * 2);
    }
}

let bossKing = null;
