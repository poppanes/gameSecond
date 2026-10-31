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

class BossKing {
    constructor() {
        this.hp = BOSS_CONFIG.maxHp;
        this.maxHp = BOSS_CONFIG.maxHp;
        this.hurtTimer = 0;                    // 受击（闪烁+停止移动）剩余
        this.flipTimer = BOSS_CONFIG.flipInterval;
        this.spawnTimer = BOSS_CONFIG.spawnInterval;
        this.spawnAnim = 0;                    // 释放动作动画剩余
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
            img.onload = () => { this.sheets[key] = { img, frames: buildBossFrames(img, cols, rows) }; };
            img.src = src;
        });
    }

    update(dt) {
        this.animClock += dt;
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

    // B2：翻转两行或两列（白格→灰；玩家站在被翻的白格上受伤）
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
        let hitPlayer = false;
        cells.forEach(([c, r]) => {
            const t = map.tiles[r] && map.tiles[r][c];
            if (!t) return;
            if (t.color === map.cellColor) {
                t.color = map.flippedColor;
                t.borderColor = map.flippedBorderColor;
                t.flipped = true;
                addFlipAnimation(c, r, map.cellColor, map.borderColor, map.flippedColor, map.flippedBorderColor);
            }
            if (player && !player.dying && player.gridX === c && player.gridY === r) hitPlayer = true;
        });
        if (hitPlayer && player && !player.dying) player.takeDamage(1);
        if (typeof Sfx !== 'undefined') Sfx.play('bossFlip');
        console.log('[Boss][LOG] 幽灵王翻转（' + cells.length + ' 格，debugLog 开启可见行列）');
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
        m.alive = true; m.warning = 2000; m.stunned = 0; m.flying = false; m.carried = false;
        m.pixelX = OFFSET_X + col * CELL_SIZE + BORDER_WIDTH;   // 生成在锁定格的格中心（居中）
        m.pixelY = OFFSET_Y + row * CELL_SIZE + BORDER_WIDTH;
        m.targetPixelX = m.pixelX; m.targetPixelY = m.pixelY;
        m.gridX = col; m.gridY = row;
        enemies.push(m);
        console.log('[Boss][LOG] 释放小怪空降 (' + col + ',' + row + ')（锁定释放格）BOSS=' + Math.round(this.px) + ',' + Math.round(this.py) + ' msize=' + Math.round(m.size));
    }

    draw(ctx) {
        const sheetKey = this.state === 'hurt' ? 'hurt' : (this.state === 'spawn' ? 'spawn' : 'fly');
        const sheet = this.sheets[sheetKey];
        if (!sheet) return;
        const frames = sheet.frames;
        const frame = frames[Math.floor(this.animClock / 120) % frames.length];
        const w = frame.w * BOSS_CONFIG.scale, h = frame.h * BOSS_CONFIG.scale;
        ctx.drawImage(sheet.img, frame.x, frame.y, frame.w, frame.h, this.px, this.py, w, h);
        // 受击闪烁（白色半透明罩闪烁）
        if (this.state === 'hurt' && Math.floor(this.hurtTimer / 100) % 2 === 0) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#fff';
            ctx.fillRect(this.px, this.py, w, h);
            ctx.restore();
        }
    }

    // 血量条（BOSS 战顶部）
    drawHpBar(ctx) {
        const w = 300, h = 16;
        const x = (CANVAS_WIDTH - w) / 2, y = 60;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        ctx.fillStyle = '#e94560';
        ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), h);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS ' + this.hp + '/' + this.maxHp, CANVAS_WIDTH / 2, y + h / 2 + 4);
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
    // 两格联动翻转：当前格 + 随机同列/同行邻格（灰→白，干扰玩家通关）
    _flipCurrentAndAdjacent() {
        if (!map) return false;
        let flippedAny = false;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
        [[this.gridX, this.gridY], [this.gridX + dx, this.gridY + dy]].forEach(([c, r]) => {
            if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
            if (map.hasBox(c, r)) return;
            if (map.isTileFlipped(c, r)) {
                const t = map.tiles[r][c];
                addPendingFlip(c, r, t.color, t.borderColor, map.cellColor, map.borderColor, true, getBoostedInterval(ENEMY_FLIP_DELAY));
                flippedAny = true;
            }
        });
        if (flippedAny) console.log('[BossMinion] 两格联动翻转（含邻格）');
        return flippedAny;
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
