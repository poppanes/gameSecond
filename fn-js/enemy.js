// ============================================
// 敌人系统
// ============================================

// --- 全局配置 ---
let ENEMY_FLIP_DELAY = 1200;      // 翻转地板延迟(ms)
let ENEMY_MOVE_SPEED = 0.25;      // 移动速度(像素/ms)
let ENEMY_STUN_DURATION = 4000;    // 硬直时长(ms)
let ENEMY_RESPAWN_TIME = 11000;    // 复活等待时间(ms)
let ENEMY_WARNING_TIME = 3000;     // 复活前预警闪烁(ms)
let SPIDER_MOVE_INTERVAL = 2000;   // Spider 随机移动间隔(ms)
let SPIDER_FLIP_CHANCE = 0.25;     // Spider 翻转概率(0~1)
let SPIDER_FLIP_INTERVAL = 2500;   // Spider 翻转尝试间隔(ms)
let SNOWMAN_RAGE_DURATION = 3000;  // 狂暴时长(ms)
let SNOWMAN_NORMAL_DURATION = 15000; // 正常时长(ms)
let SNOWMAN_RAGE_SPEED = 0.45;     // 狂暴移动速度
let OCTOPUS_MOVE_INTERVAL = 700;   // Octopus 快速不规律移动间隔(ms)
let OCTOPUS_FLIP_CHANCE = 0.2;     // Octopus 翻转概率(0~1)
let OCTOPUS_FLIP_INTERVAL = 2500;  // Octopus 翻转尝试间隔(ms)
let OCTOPUS_TRACK_RANGE = 1;       // 追踪触发距离(格)
let OCTOPUS_DROP_RANGE = 2;        // 放弃追踪距离(格)
let OWL_MOVE_INTERVAL = 1000;      // Owl 正常移动间隔(ms)
let OWL_JUMP_INTERVAL = 15000;      // Owl 跳跃打洞间隔(ms)
let OWL_FLIP_INTERVAL = 3000;      // Owl 翻板间隔(ms)
let OWL_FLIP_CHANCE = 0.35;        // Owl 翻板概率(0~1)
let TIME_DANGER_THRESHOLD = 50000;  // 时间低于此值(ms)进入加速
let TIME_DANGER_SPEED_MULT = 1.5;   // 加速阶段移动速度倍率
let TIME_DANGER_FLIP_MULT = 2;      // 加速阶段翻板速度倍率
let FORCE_ENEMY_TYPE = 'Owl';        // 强制怪物类型（null=随机, 'Ghost','Spider','Snowman','Octopus','Owl'）
let MAX_ENEMIES = 1;                // 地图上最大怪物数量
let THROW_FLY_SPEED = 1;          // 投掷飞行速度(像素/ms)
let THROW_KNOCKBACK_SPEED = 1.2;    // 撞飞被撞怪物速度(像素/ms)
let BOUNCE_GRAVITY = 0.002;         // 反弹怪物重力加速度(px/ms²)
let enemies = [];                  // 所有敌人列表
let respawnQueue = [];             // 复活队列 [{type, col, row, timer, spawned}]
let blackHoles = [];               // 黑洞列表 [{col, row, owner}]

// --- 统一生成点（所有怪物从四角出生）---
const SPAWN_POINTS = [
    { col: 0, row: 0 },
    { col: 7, row: 0 },
    { col: 0, row: 6 },
    { col: 7, row: 6 }
];

// 是否处于危险加速阶段（时间低于阈值）
function isTimeDanger() {
    return game && typeof game.timeLeft === 'number' && game.timeLeft < TIME_DANGER_THRESHOLD;
}

// 获取加速后的移动速度（原速度 × 倍率）
function getBoostedSpeed(baseSpeed) {
    return isTimeDanger() ? baseSpeed * TIME_DANGER_SPEED_MULT : baseSpeed;
}

// 获取加速后的翻板间隔（原间隔 ÷ 倍率，更频繁）
function getBoostedInterval(baseInterval) {
    return isTimeDanger() ? baseInterval / TIME_DANGER_FLIP_MULT : baseInterval;
}

// 检查某格子是否被其他存活怪物占据（防重叠）
function _isCellBlocked(col, row, excludeSelf = null) {
    return enemies.some(e => e && e !== excludeSelf && e.alive && !e.flying &&
        e.gridX === col && e.gridY === row);
}

// ============================================
// 敌人基类（寻路 / 平滑移动 / 翻板 / 碰撞 / 绘制）
// ============================================
class Enemy {
    constructor(col, row, imageSrc, name = 'enemy') {
        this.gridX = col;
        this.gridY = row;
        this.spawnCol = col;    // 出生点（复活用）
        this.spawnRow = row;
        this.size = CELL_SIZE - BORDER_WIDTH * 2;
        this.name = name;

        // 平滑移动
        this.pixelX = OFFSET_X + col * CELL_SIZE + BORDER_WIDTH;
        this.pixelY = OFFSET_Y + row * CELL_SIZE + BORDER_WIDTH;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        this.moveCooldown = 300;
        this.moveSpeed = ENEMY_MOVE_SPEED;

        this.alive = true;
        this._killed = false;   // 防重复入复活队列
        this.warning = 0;       // 复活预警倒计时(ms)
        this.pushed = 0;
        this.stunned = 0;
        this.carried = false;
        this.flying = false;
        this.flyDx = 0;
        this.flyDy = 0;
        this.bouncing = false;  // 反弹抛物线状态

        // 素材
        this.image = new Image();
        this.imageLoaded = false;
        this.image.src = imageSrc;
        this.image.onload = () => { this.imageLoaded = true; };
        
        // 硬直素材（玩家翻转击杀时显示）
        this.deathImage = new Image();
        this.deathImageLoaded = false;
        this.deathImage.src = '../fn-image/ghost_death.png';
        this.deathImage.onload = () => { this.deathImageLoaded = true; };
    }

    // 判断格子是否可通行（避开石头/箱子/黑洞）
    _canPass(col, row) {
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
        if (map && map.hasStone(col, row)) return false;
        if (map && map.hasBox(col, row)) return false;
        if (isBlackHole(col, row)) return false;
        return true;
    }

    /* ---- 被箱子推动 ---- */
    pushTo(newCol, newRow) {
        this.gridX = newCol;
        this.gridY = newRow;
        this.pixelX = OFFSET_X + newCol * CELL_SIZE + BORDER_WIDTH;
        this.pixelY = OFFSET_Y + newRow * CELL_SIZE + BORDER_WIDTH;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        this.moveCooldown = 0;
        this.pushed = 800;  // 被推后 800ms 内暂停自主移动
    }
    
    /* ---- 寻路 (BFS) ---- */
    findPath() {
        if (!player) return null;
        const start = `${this.gridX},${this.gridY}`;
        if (start === `${player.gridX},${player.gridY}`) return null;

        const visited = new Set([start]);
        const queue = [{ x: this.gridX, y: this.gridY, path: [] }];
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

        while (queue.length > 0) {
            const { x, y, path } = queue.shift();
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (nx === player.gridX && ny === player.gridY) {
                    return path.length === 0 ? { dx, dy } : path[0];
                }
                if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited.has(key)) {
                    if (this._canPass(nx, ny)) {
                        visited.add(key);
                        queue.push({ x: nx, y: ny, path: [...path, { dx, dy }] });
                    }
                }
            }
        }
        return null;
    }

    /* ---- 帧更新 ---- */
    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;

        // 复活预警中：倒计时，不可行动
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }

        // 飞行中：直线飞出，遇障碍消失
        if (this.flying) {
            const speed = this.moveSpeed || THROW_FLY_SPEED; // 飞行速度（被撞飞的可更快）
            
            // 反弹抛物线：重力持续拉低 flyDy
            if (this.bouncing) {
                this.flyDy += BOUNCE_GRAVITY * dt;
            }
            
            const step = speed * dt;
            const moveX = this.flyDx * step;
            const moveY = this.flyDy * step;
            this.pixelX += moveX;
            this.pixelY += moveY;
            
            // 当前所在的粗略格（同步 gridX/gridY，避免碰撞检测用过时坐标误判）
            const cx = Math.round((this.pixelX - OFFSET_X) / CELL_SIZE);
            const cy = Math.round((this.pixelY - OFFSET_Y) / CELL_SIZE);
            if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
                this.gridX = cx;
                this.gridY = cy;
            }
            
            // 飞出地图边缘 → 消失
            if (this.pixelX < OFFSET_X - CELL_SIZE || 
                this.pixelX > OFFSET_X + COLS * CELL_SIZE ||
                this.pixelY < OFFSET_Y - CELL_SIZE ||
                this.pixelY > OFFSET_Y + ROWS * CELL_SIZE) {
                this.alive = false;  // game.js 清理循环会调用 killEnemy 入复活队列
                console.log(`[enemy] 飞行出地图外，等待复活`);
                return;
            }
            
            // 撞障碍物 → 消失
            if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
                // 撞到其他怪物（遍历所有同格怪物，避免只处理第一只） → 被撞的全部撞飞出地图
                const hitEnemies = enemies.filter(e => e !== this && e.alive && e.stunned <= 0 && 
                    e.gridX === cx && e.gridY === cy);
                if (hitEnemies.length > 0) {
                    hitEnemies.forEach(hitEnemy => {
                        console.log(`[enemy] ${this.name} 飞行撞到 ${hitEnemy.name}(${cx},${cy}) → 撞飞`);
                        // 被撞怪物：斜上飞出 + 高速撞飞效果
                        hitEnemy.carried = false;
                        hitEnemy.flying = true;
                        hitEnemy.moveSpeed = THROW_FLY_SPEED;
                        hitEnemy.flyDx = this.flyDx;
                        hitEnemy.flyDy = this.flyDy === 0 ? -1 : this.flyDy * 2;
                        // 用怪物当前实际像素位置（已经移动过），不要回退到旧 grid 对应的 targetPixel
                        hitEnemy.pixelX = this.pixelX;
                        hitEnemy.pixelY = this.pixelY;
                        hitEnemy.gridX = cx;
                        hitEnemy.gridY = cy;
                        // 如果被撞的已经在地图边缘，立即推到边外 → 下一帧出界死亡
                        const atRightEdge = hitEnemy.flyDx > 0 && cx === COLS - 1;
                        const atLeftEdge = hitEnemy.flyDx < 0 && cx === 0;
                        const atTopEdge = hitEnemy.flyDy < 0 && cy === 0;
                        const atBottomEdge = hitEnemy.flyDy > 0 && cy === ROWS - 1;
                        if (atRightEdge || atLeftEdge || atTopEdge || atBottomEdge) {
                            // 推到 1.5 格外的位置（保证下一帧立刻满足出界条件 → 立刻死亡，不卡边缘）
                            if (atRightEdge) hitEnemy.pixelX = OFFSET_X + (COLS + 1.5) * CELL_SIZE;
                            if (atLeftEdge) hitEnemy.pixelX = OFFSET_X - 1.5 * CELL_SIZE;
                            if (atTopEdge) hitEnemy.pixelY = OFFSET_Y - 1.5 * CELL_SIZE;
                            if (atBottomEdge) hitEnemy.pixelY = OFFSET_Y + (ROWS + 1.5) * CELL_SIZE;
                            console.log(`[enemy] ${hitEnemy.name} 在边缘，立即推过`);
                        }
                    });
                    // 当前怪物减速反弹 + 抛物线飞出
                    this.flyDx *= -0.5;
                    this.flyDy = -1.5;  // 初始向上冲，配合重力产生抛物线
                    this.bouncing = true;
                    return;
                }
                // 撞到石头/箱子
                if (map && (map.hasStone(cx, cy) || map.hasBox(cx, cy))) {
                    this.alive = false;
                    console.log(`[enemy] 飞行撞障碍(${cx},${cy})，等待复活`);
                    return;
                }
            }
            return;
        }

        // 被拾取中：跟随玩家，不行动
        if (this.carried) {
            this.gridX = player.gridX;
            this.gridY = player.gridY;
            this.pixelX = player.pixelX;
            this.pixelY = player.pixelY;
            return;
        }

        // 硬直中：暂停所有活动，计时结束后恢复正常
        if (this.stunned > 0) {
            this.stunned = Math.max(0, this.stunned - dt);
            return;
        }

        // 被推期间禁用自主移动
        if (this.pushed > 0) {
            this.pushed = Math.max(0, this.pushed - dt);
            return;
        }
        
        if (this.moveCooldown > 0) {
            this.moveCooldown = Math.max(0, this.moveCooldown - dt);
        }

        // 滑行中（加速阶段移动更快）
        if (this.isMoving) {
            const dx = this.targetPixelX - this.pixelX;
            const dy = this.targetPixelY - this.pixelY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 0.5) {
                this.pixelX = this.targetPixelX;
                this.pixelY = this.targetPixelY;
                this.isMoving = false;
                this._onArrive();
            } else {
                const spd = getBoostedSpeed(this.moveSpeed);
                const step = Math.min(spd * dt, dist);
                this.pixelX += (dx / dist) * step;
                this.pixelY += (dy / dist) * step;
            }
            return;
        }

        // 寻路下一步
        if (this.moveCooldown <= 0) {
            const dir = this.findPath();
            if (dir) {
                this.gridX += dir.dx;
                this.gridY += dir.dy;
                this.targetPixelX = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
                this.targetPixelY = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
                this.isMoving = true;
            }
        }
    }

    /* ---- 到达新格子 ---- */
    _onArrive() {
        let cooldown = getBoostedInterval(300);

        // 翻回白色地板（加速阶段翻板更快）
        if (map && map.isTileFlipped(this.gridX, this.gridY)) {
            const t = map.tiles[this.gridY][this.gridX];
            addPendingFlip(this.gridX, this.gridY,
                t.color, t.borderColor,
                map.cellColor, map.borderColor,
                true, getBoostedInterval(ENEMY_FLIP_DELAY));
            cooldown = getBoostedInterval(ENEMY_FLIP_DELAY) + 400;
        }

        this.moveCooldown = cooldown;

        // 碰撞玩家
        if (player && !player.isDead() &&
            this.gridX === player.gridX && this.gridY === player.gridY) {
            this._hitPlayer();
        }
    }

    /* ---- 碰到玩家 ---- */
    _hitPlayer() {
        if (!player || !player.takeDamage) return;
        if (player.invTimer > 0) return;  // 无敌中直接跳过
        player.takeDamage(1);
        player.respawn();
        if (player.isDead()) {
            game.gameOver = true;
            if (gameInput) gameInput.enabled = false;
        }
    }

    /* ---- 绘制 ---- */
    draw(ctx) {
        if (!this.alive) return;
        // 复活预警 → 频闪
        if (this.warning > 0 && this.imageLoaded) {
            if (Math.floor(this.warning / 150) % 2 === 0) ctx.globalAlpha = 0.25;
            ctx.drawImage(this.image, this.pixelX, this.pixelY, this.size, this.size);
            ctx.globalAlpha = 1;
            return;
        }
        // 硬直状态 → 显示死亡素材
        if (this.stunned > 0 && this.deathImageLoaded) {
            // 最后一半时间闪烁提示即将恢复
            const half = ENEMY_STUN_DURATION / 2;
            if (this.stunned < half && Math.floor(this.stunned / 120) % 2 === 0) {
                ctx.globalAlpha = 0.4;
            }
            ctx.drawImage(this.deathImage, this.pixelX, this.pixelY, this.size, this.size);
            ctx.globalAlpha = 1;
            return;
        }
        // 正常状态
        if (!this.imageLoaded) return;
        ctx.drawImage(this.image, this.pixelX, this.pixelY, this.size, this.size);
    }
}

// ============================================
// Ghost 幽灵（优先翻板，再追玩家）
// ============================================
class Ghost extends Enemy {
    constructor(col, row) {
        super(col, row, '../fn-image/ghost_base_extracted.png', 'Ghost');
        this._targetCache = null;
    }

    /* ---- 重写 update：邻格扫描优先于寻路 ---- */
    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;

        // 复活预警中
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }

        // 飞行中：移动交给基类
        if (this.flying) {
            super.update(dt);
            return;
        }

        // 被拾取中：跟随玩家
        if (this.carried) {
            this.gridX = player.gridX;
            this.gridY = player.gridY;
            this.pixelX = player.pixelX;
            this.pixelY = player.pixelY;
            return;
        }

        // 硬直中：暂停所有活动
        if (this.stunned > 0) {
            this.stunned = Math.max(0, this.stunned - dt);
            return;
        }

        // 被推期间禁用自主移动
        if (this.pushed > 0) {
            this.pushed = Math.max(0, this.pushed - dt);
            return;
        }

        if (this.moveCooldown > 0) {
            this.moveCooldown = Math.max(0, this.moveCooldown - dt);
        }

        // 滑行中（复用基类逻辑，加速阶段更快）
        if (this.isMoving) {
            const dx = this.targetPixelX - this.pixelX;
            const dy = this.targetPixelY - this.pixelY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.5) {
                this.pixelX = this.targetPixelX;
                this.pixelY = this.targetPixelY;
                this.isMoving = false;
                this._onArrive();
            } else {
                const spd = getBoostedSpeed(this.moveSpeed);
                const step = Math.min(spd * dt, dist);
                this.pixelX += (dx / dist) * step;
                this.pixelY += (dy / dist) * step;
            }
            return;
        }

        if (this.moveCooldown <= 0) {
            // 优先：扫描当前和相邻格，原地翻转
            if (this._flipCurrentAndAdjacent()) {
                this.moveCooldown = getBoostedInterval(ENEMY_FLIP_DELAY) + 400;
                return;
            }
            // 其次：寻路到远处的已翻转地板
            const dir = this.findPath();
            if (dir) {
                const nx = this.gridX + dir.dx;
                const ny = this.gridY + dir.dy;
                // 下一格有箱子或被怪物占据 → 不走
                if ((map && map.hasBox(nx, ny)) || _isCellBlocked(nx, ny, this)) {
                    this.moveCooldown = 400;
                    return;
                }
                this.gridX = nx;
                this.gridY = ny;
                this.targetPixelX = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
                this.targetPixelY = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
                this.isMoving = true;
            }
        }
    }

    /* 只翻当前行：脚下 → 左边邻格 → 右边邻格（一次一个，不跨行，跳过箱子） */
    _flipCurrentAndAdjacent() {
        if (!map) return false;

        // 1) 当前格子（怪物脚下不可能有箱子，但仍加保护）
        if (!map.hasBox(this.gridX, this.gridY) && map.isTileFlipped(this.gridX, this.gridY)) {
            const t = map.tiles[this.gridY][this.gridX];
            addPendingFlip(this.gridX, this.gridY,
                t.color, t.borderColor, map.cellColor, map.borderColor,
                true, getBoostedInterval(ENEMY_FLIP_DELAY));
            console.log(`[Ghost] 原地翻转当前(${this.gridX},${this.gridY})`);
            return true;
        }

        // 2) 同行左边邻格（跳过箱子）
        const left = this.gridX - 1;
        if (left >= 0 && !map.hasBox(left, this.gridY) && map.isTileFlipped(left, this.gridY)) {
            const t = map.tiles[this.gridY][left];
            addPendingFlip(left, this.gridY,
                t.color, t.borderColor, map.cellColor, map.borderColor,
                true, getBoostedInterval(ENEMY_FLIP_DELAY));
            console.log(`[Ghost] 原地翻转左边(${left},${this.gridY})`);
            return true;
        }

        // 3) 同行右边邻格（跳过箱子）
        const right = this.gridX + 1;
        if (right < COLS && !map.hasBox(right, this.gridY) && map.isTileFlipped(right, this.gridY)) {
            const t = map.tiles[this.gridY][right];
            addPendingFlip(right, this.gridY,
                t.color, t.borderColor, map.cellColor, map.borderColor,
                true, getBoostedInterval(ENEMY_FLIP_DELAY));
            console.log(`[Ghost] 原地翻转右边(${right},${this.gridY})`);
            return true;
        }

        return false;
    }

    /* ---- 找到下一步目标（跳过相邻格，因为可以原地翻）---- */
    _findTarget() {
        const tc = this._targetCache;
        // 缓存有效：未到达、仍翻转、且没有箱子挡路
        if (tc &&
            !(tc.x === this.gridX && tc.y === this.gridY) &&
            map && map.isTileFlipped(tc.x, tc.y) &&
            !map.hasBox(tc.x, tc.y)) {
            return tc;
        }
        this._targetCache = null;

        let t = this._scanRow();
        if (t) { this._targetCache = t; return t; }

        t = this._scanCol();
        if (t) { this._targetCache = t; return t; }

        t = this._bfsNearestFlipped();
        if (t) { this._targetCache = t; return t; }

        // 没有可翻的灰色地板 → 直接追玩家（不缓存，玩家位置随时变）
        if (player) return { x: player.gridX, y: player.gridY };
        return null;
    }

    _scanRow() {
        // 左边优先：从近到远扫完左边，再扫右边（跳过箱子）
        for (let c = this.gridX - 2; c >= 0; c--) {
            if (map && !map.hasBox(c, this.gridY) && map.isTileFlipped(c, this.gridY))
                return { x: c, y: this.gridY };
        }
        for (let c = this.gridX + 2; c < COLS; c++) {
            if (map && !map.hasBox(c, this.gridY) && map.isTileFlipped(c, this.gridY))
                return { x: c, y: this.gridY };
        }
        return null;
    }

    _scanCol() {
        let best = null, bestDist = Infinity;
        for (let r = 0; r < ROWS; r++) {
            const d = Math.abs(r - this.gridY);
            if (d <= 1) continue;
            if (map && !map.hasBox(this.gridX, r) && map.isTileFlipped(this.gridX, r)) {
                if (d < bestDist) { bestDist = d; best = { x: this.gridX, y: r }; }
            }
        }
        return best;
    }

    _bfsNearestFlipped() {
        if (!map) return null;
        const start = `${this.gridX},${this.gridY}`;
        const visited = new Set([start]);
        const queue = [{ x: this.gridX, y: this.gridY }];
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

        while (queue.length > 0) {
            const { x, y } = queue.shift();
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (visited.has(key)) continue;
                if (map.hasStone(nx, ny) || map.hasBox(nx, ny)) continue;
                if (map.isTileFlipped(nx, ny) &&
                    (Math.abs(nx - this.gridX) + Math.abs(ny - this.gridY)) > 1) {
                    return { x: nx, y: ny };
                }
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
        return null;
    }

    /* ---- 重写寻路 ---- */
    findPath() {
        const target = this._findTarget();
        if (!target) return null;
        const start = `${this.gridX},${this.gridY}`;
        if (start === `${target.x},${target.y}`) return null;

        const visited = new Set([start]);
        const queue = [{ x: this.gridX, y: this.gridY, path: [] }];
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

        while (queue.length > 0) {
            const { x, y, path } = queue.shift();
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                const key = `${nx},${ny}`;
                if (nx === target.x && ny === target.y) {
                    return path.length === 0 ? { dx, dy } : path[0];
                }
                if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited.has(key)) {
                    if (this._canPass(nx, ny)) {
                        visited.add(key);
                        queue.push({ x: nx, y: ny, path: [...path, { dx, dy }] });
                    }
                }
            }
        }
        return null;
    }
}

// ============================================
// Spider 蜘蛛（随机游走、低频翻板、被动攻击）
// ============================================
class Spider extends Enemy {
    constructor(col, row) {
        super(col, row, '../fn-image/spider.png', 'Spider');
        this.moveSpeed = ENEMY_MOVE_SPEED * 0.5;  // 比 Ghost 慢一半
        this.moveTimer = 0;
        this.flipTimer = 0;
        // Spider 硬直素材
        this.deathImage = new Image();
        this.deathImageLoaded = false;
        this.deathImage.src = '../fn-image/Spider_death.png';
        this.deathImage.onload = () => { this.deathImageLoaded = true; };
    }

    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;

        // 复活预警
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }
        // 飞行中
        if (this.flying) { super.update(dt); return; }
        // 被拾取
        if (this.carried) { this.gridX=player.gridX; this.gridY=player.gridY; this.pixelX=player.pixelX; this.pixelY=player.pixelY; return; }
        // 硬直
        if (this.stunned > 0) { this.stunned = Math.max(0, this.stunned - dt); return; }
        // 被推
        if (this.pushed > 0) { this.pushed = Math.max(0, this.pushed - dt); return; }

        // 随机游走（加速阶段更快）
        this.moveTimer += dt;
        if (this.moveTimer >= getBoostedInterval(SPIDER_MOVE_INTERVAL)) {
            this.moveTimer = 0;
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            const valid = dirs.filter(([dx,dy]) => {
                const nx=this.gridX+dx, ny=this.gridY+dy;
                return nx>=0&&nx<COLS&&ny>=0&&ny<ROWS && map&&!map.hasStone(nx,ny)&&!map.hasBox(nx,ny)&&!isBlackHole(nx,ny)&&!_isCellBlocked(nx,ny,this);
            });
            if (valid.length>0) {
                const [dx,dy] = valid[Math.floor(Math.random()*valid.length)];
                this.gridX+=dx; this.gridY+=dy;
                this.targetPixelX=OFFSET_X+this.gridX*CELL_SIZE+BORDER_WIDTH;
                this.targetPixelY=OFFSET_Y+this.gridY*CELL_SIZE+BORDER_WIDTH;
                this.isMoving=true;
            }
        }
        // 平滑移动
        if (this.isMoving) {
            const dx=this.targetPixelX-this.pixelX, dy=this.targetPixelY-this.pixelY, dist=Math.sqrt(dx*dx+dy*dy);
            if (dist<0.5) { this.pixelX=this.targetPixelX; this.pixelY=this.targetPixelY; this.isMoving=false; }
            else { const step=Math.min(this.moveSpeed*dt,dist); this.pixelX+=(dx/dist)*step; this.pixelY+=(dy/dist)*step; }
        }

        // 低频概率翻板（toggle：灰→白 或 白→灰）
        this.flipTimer += dt;
        if (this.flipTimer >= getBoostedInterval(SPIDER_FLIP_INTERVAL)) {
            this.flipTimer = 0;
            if (Math.random()<SPIDER_FLIP_CHANCE && map) {
                const t=map.tiles[this.gridY][this.gridX];
                const gray=map.isTileFlipped(this.gridX,this.gridY);
                addPendingFlip(this.gridX,this.gridY, t.color,t.borderColor,
                    gray?map.cellColor:map.flippedColor, gray?map.borderColor:map.flippedBorderColor,
                    true, getBoostedInterval(ENEMY_FLIP_DELAY));
                console.log(`[Spider] 翻转 (${this.gridX},${this.gridY})`);
            }
        }

        // 被动碰撞（不主动寻找玩家）
        if (!player.isDead() && player.invTimer<=0 && this.gridX===player.gridX && this.gridY===player.gridY) {
            this._hitPlayer();
        }
    }
}

// ============================================
// Snowman 雪人（狂暴3秒追玩家 ↔ 正常15秒翻板，循环）
// ============================================
class Snowman extends Enemy {
    constructor(col, row) {
        super(col, row, '../fn-image/snowmen.png', 'Snowman');
        // 出生即狂暴状态
        this.rage = true;
        this.rageTimer = SNOWMAN_RAGE_DURATION;
        this.normalTimer = 0;
        this.moveSpeed = SNOWMAN_RAGE_SPEED;  // 狂暴快速
        this.moveCooldown = 200;              // 狂暴快移
        this.flipTimer = 0;
        // 硬直素材
        this.deathImage = new Image();
        this.deathImageLoaded = false;
        this.deathImage.src = '../fn-image/snowmen_death.png';
        this.deathImage.onload = () => { this.deathImageLoaded = true; };
    }

    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }
        if (this.flying) { super.update(dt); return; }
        if (this.carried) { this.gridX=player.gridX; this.gridY=player.gridY; this.pixelX=player.pixelX; this.pixelY=player.pixelY; return; }
        if (this.stunned > 0) { this.stunned = Math.max(0, this.stunned - dt); return; }
        if (this.pushed > 0) { this.pushed = Math.max(0, this.pushed - dt); return; }

        // 状态切换
        if (this.rage) {
            // 狂暴：3秒后恢复正常
            this.rageTimer -= dt;
            if (this.rageTimer <= 0) {
                this.rage = false;
                this.normalTimer = SNOWMAN_NORMAL_DURATION;
                this.moveSpeed = ENEMY_MOVE_SPEED * 0.8;
                this.moveCooldown = 400;
                console.log(`[Snowman] 狂暴结束，进入正常`);
            }
        } else {
            // 正常：15秒后恢复狂暴
            this.normalTimer -= dt;
            if (this.normalTimer <= 0) {
                this.rage = true;
                this.rageTimer = SNOWMAN_RAGE_DURATION;
                this.moveSpeed = SNOWMAN_RAGE_SPEED;
                this.moveCooldown = 200;
                console.log(`[Snowman] 进入狂暴`);
            }
        }

        // 平滑移动（基类复用，加速阶段更快）
        if (this.isMoving) {
            const dx=this.targetPixelX-this.pixelX, dy=this.targetPixelY-this.pixelY, dist=Math.sqrt(dx*dx+dy*dy);
            if (dist<0.5) { this.pixelX=this.targetPixelX; this.pixelY=this.targetPixelY; this.isMoving=false; this._onArrive(); }
            else { const spd=getBoostedSpeed(this.moveSpeed); const step=Math.min(spd*dt,dist); this.pixelX+=(dx/dist)*step; this.pixelY+=(dy/dist)*step; }
            return;
        }

        if (this.moveCooldown > 0) this.moveCooldown = Math.max(0, this.moveCooldown - dt);
        if (this.moveCooldown > 0) return;

        if (this.rage) {
            // 狂暴：BFS 追击玩家
            const dir = this.findPath();
            if (dir) {
                const nx = this.gridX + dir.dx;
                const ny = this.gridY + dir.dy;
                if (!_isCellBlocked(nx, ny, this)) {
                    this.gridX += dir.dx; this.gridY += dir.dy;
                    this.targetPixelX=OFFSET_X+this.gridX*CELL_SIZE+BORDER_WIDTH;
                    this.targetPixelY=OFFSET_Y+this.gridY*CELL_SIZE+BORDER_WIDTH;
                    this.isMoving = true;
                    this.moveCooldown = getBoostedInterval(200);
                }
            }
        } else {
            // 正常：识别已翻转地板去翻转
            const target = this._findFlippedTarget();
            if (target) {
                const dir = this._bfsStep(target);
                if (dir) {
                    const nx = this.gridX + dir.dx;
                    const ny = this.gridY + dir.dy;
                    if (!_isCellBlocked(nx, ny, this)) {
                        this.gridX += dir.dx; this.gridY += dir.dy;
                        this.targetPixelX=OFFSET_X+this.gridX*CELL_SIZE+BORDER_WIDTH;
                        this.targetPixelY=OFFSET_Y+this.gridY*CELL_SIZE+BORDER_WIDTH;
                        this.isMoving = true;
                        this.moveCooldown = getBoostedInterval(400);
                        return;
                    }
                }
            }
            // 无目标则随机走
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            const valid = dirs.filter(([dx,dy]) => {
                const nx=this.gridX+dx, ny=this.gridY+dy;
                return nx>=0&&nx<COLS&&ny>=0&&ny<ROWS && map&&!map.hasStone(nx,ny)&&!map.hasBox(nx,ny)&&!isBlackHole(nx,ny)&&!_isCellBlocked(nx,ny,this);
            });
            if (valid.length>0) {
                const [dx,dy] = valid[Math.floor(Math.random()*valid.length)];
                this.gridX+=dx; this.gridY+=dy;
                this.targetPixelX=OFFSET_X+this.gridX*CELL_SIZE+BORDER_WIDTH;
                this.targetPixelY=OFFSET_Y+this.gridY*CELL_SIZE+BORDER_WIDTH;
                this.isMoving=true;
                this.moveCooldown=getBoostedInterval(400);
            }
        }
    }

    // 找到最近的已翻转地板
    _findFlippedTarget() {
        if (!map) return null;
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        const queue = [{ x: this.gridX, y: this.gridY }];
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
        while (queue.length) {
            const { x, y } = queue.shift();
            for (const [dx,dy] of dirs) {
                const nx=x+dx, ny=y+dy;
                const key = `${nx},${ny}`;
                if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
                if (visited.has(key)) continue;
                if (map.hasStone(nx,ny)||map.hasBox(nx,ny)) continue;
                if (map.isTileFlipped(nx,ny)) return { x:nx, y:ny };
                visited.add(key);
                queue.push({ x:nx, y:ny });
            }
        }
        return null;
    }

    // BFS 向目标走一步
    _bfsStep(target) {
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        const queue = [{ x:this.gridX, y:this.gridY, path:[] }];
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
        while (queue.length) {
            const { x, y, path } = queue.shift();
            for (const [dx,dy] of dirs) {
                const nx=x+dx, ny=y+dy;
                const key=`${nx},${ny}`;
                if (nx===target.x&&ny===target.y) return path.length===0?{dx,dy}:path[0];
                if (nx>=0&&nx<COLS&&ny>=0&&ny<ROWS&&!visited.has(key)) {
                    if (map&&!map.hasStone(nx,ny)&&!map.hasBox(nx,ny)&&!isBlackHole(nx,ny)) {
                        visited.add(key);
                        queue.push({x:nx,y:ny,path:[...path,{dx,dy}]});
                    }
                }
            }
        }
        return null;
    }
}

// ============================================
// Octopus 章鱼（快速不规律移动、推箱子、低频翻板、近战追踪）
// ============================================
class Octopus extends Enemy {
    constructor(col, row) {
        super(col, row, '../fn-image/octopus.png', 'Octopus');
        this.moveSpeed = ENEMY_MOVE_SPEED * 1.6;  // 快速
        this.moveTimer = 0;
        this.flipTimer = 0;
        this.tracking = false;   // 是否在追踪玩家
        this.distX = 0;
        this.distY = 0;
        // 硬直素材
        this.deathImage = new Image();
        this.deathImageLoaded = false;
        this.deathImage.src = '../fn-image/octopus_death.png';
        this.deathImage.onload = () => { this.deathImageLoaded = true; };
    }

    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }
        if (this.flying) { super.update(dt); return; }
        if (this.carried) { this.gridX=player.gridX; this.gridY=player.gridY; this.pixelX=player.pixelX; this.pixelY=player.pixelY; return; }
        if (this.stunned > 0) { this.stunned = Math.max(0, this.stunned - dt); return; }
        if (this.pushed > 0) { this.pushed = Math.max(0, this.pushed - dt); return; }

        // 计算与玩家距离（曼哈顿）
        this.distX = Math.abs(this.gridX - player.gridX);
        this.distY = Math.abs(this.gridY - player.gridY);

        // 追踪状态切换
        if (!this.tracking && this.distX + this.distY <= OCTOPUS_TRACK_RANGE) {
            this.tracking = true;  // 靠近1格内开始追踪
        } else if (this.tracking && this.distX + this.distY > OCTOPUS_DROP_RANGE) {
            this.tracking = false;  // 远离2格外放弃
        }

        // 平滑移动（加速阶段更快）
        if (this.isMoving) {
            const dx=this.targetPixelX-this.pixelX, dy=this.targetPixelY-this.pixelY, dist=Math.sqrt(dx*dx+dy*dy);
            if (dist<0.5) { this.pixelX=this.targetPixelX; this.pixelY=this.targetPixelY; this.isMoving=false; }
            else { const spd=getBoostedSpeed(this.moveSpeed); const step=Math.min(spd*dt,dist); this.pixelX+=(dx/dist)*step; this.pixelY+=(dy/dist)*step; }
            return;
        }

        this.moveTimer += dt;
        if (this.moveTimer < getBoostedInterval(OCTOPUS_MOVE_INTERVAL)) return;
        this.moveTimer = 0;

        // 尝试多个方向，找到能走的方向
        const tryDirs = [];
        if (this.tracking) {
            // 追踪：玩家方向优先，但加入备选
            if (this.gridX !== player.gridX) {
                const d = this.gridX < player.gridX ? 1 : -1;
                tryDirs.push([d, 0]);
            } else if (this.gridY !== player.gridY) {
                const d = this.gridY < player.gridY ? 1 : -1;
                tryDirs.push([0, d]);
            }
            // 备选方向
            tryDirs.push([0, 1], [0, -1], [1, 0], [-1, 0]);
        } else {
            // 不规律随机移动
            const all = [[-1,0],[1,0],[0,-1],[0,1]];
            // 洗牌
            for (let i = all.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [all[i], all[j]] = [all[j], all[i]];
            }
            tryDirs.push(...all);
        }
        
        let moved = false;
        for (const [dx, dy] of tryDirs) {
            const nx=this.gridX+dx, ny=this.gridY+dy;
            // 越界
            if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
            // 石头或黑洞或被怪物占据
            if (map && (map.hasStone(nx,ny) || isBlackHole(nx,ny))) continue;
            if (_isCellBlocked(nx, ny, this)) continue;
            
            if (map && map.hasBox(nx,ny)) {
                // 尝试推箱子
                const r = map.pushBox(nx,ny,dx,dy);
                if (r === false) continue;  // 推不动，换方向
                this.gridX=nx; this.gridY=ny;
                this.targetPixelX=OFFSET_X+nx*CELL_SIZE+BORDER_WIDTH;
                this.targetPixelY=OFFSET_Y+ny*CELL_SIZE+BORDER_WIDTH;
                this.isMoving=true;
                console.log(`[Octopus] 推开箱子`);
                moved = true;
            } else {
                this.gridX=nx; this.gridY=ny;
                this.targetPixelX=OFFSET_X+nx*CELL_SIZE+BORDER_WIDTH;
                this.targetPixelY=OFFSET_Y+ny*CELL_SIZE+BORDER_WIDTH;
                this.isMoving=true;
                moved = true;
            }
            break;  // 成功移动，结束尝试
        }
        if (!moved) console.log(`[Octopus] 所有方向被阻，停在 (${this.gridX},${this.gridY})`);

        // 低频翻转（加速阶段更快）
        this.flipTimer += dt;
        if (this.flipTimer >= getBoostedInterval(OCTOPUS_FLIP_INTERVAL)) {
            this.flipTimer = 0;
            if (Math.random()<OCTOPUS_FLIP_CHANCE && map && map.isTileFlipped(this.gridX,this.gridY)) {
                const t=map.tiles[this.gridY][this.gridX];
                addPendingFlip(this.gridX,this.gridY, t.color,t.borderColor,
                    map.cellColor, map.borderColor, true, getBoostedInterval(ENEMY_FLIP_DELAY));
                console.log(`[Octopus] 翻回白色 (${this.gridX},${this.gridY})`);
            }
        }

        // 碰撞玩家
        if (!player.isDead() && player.invTimer<=0 && this.gridX===player.gridX && this.gridY===player.gridY) {
            this._hitPlayer();
        }
    }
}

// ============================================
// Owl 猫头鹰（移速正常、跳跃打洞为黑洞、不追击）
// ============================================
class Owl extends Enemy {
    constructor(col, row) {
        super(col, row, '../fn-image/owl.png', 'Owl');
        this.moveSpeed = ENEMY_MOVE_SPEED * 1.0;  // 正常速度
        this.moveTimer = 0;
        this.jumpTimer = OWL_JUMP_INTERVAL;
        this.flipTimer = 0;  // 翻板计时器
        // 硬直素材
        this.deathImage = new Image();
        this.deathImageLoaded = false;
        this.deathImage.src = '../fn-image/owl_death.png';
        this.deathImage.onload = () => { this.deathImageLoaded = true; };
    }

    update(dt) {
        if (!this.alive || !player) return;
        if (!isFinite(dt)) dt = 0;
        if (this.warning > 0) { this.warning = Math.max(0, this.warning - dt); return; }
        if (this.flying) { super.update(dt); return; }
        if (this.carried) { this.gridX=player.gridX; this.gridY=player.gridY; this.pixelX=player.pixelX; this.pixelY=player.pixelY; return; }
        if (this.stunned > 0) { this.stunned = Math.max(0, this.stunned - dt); return; }
        if (this.pushed > 0) { this.pushed = Math.max(0, this.pushed - dt); return; }

        // 平滑移动（加速阶段更快）
        if (this.isMoving) {
            const dx=this.targetPixelX-this.pixelX, dy=this.targetPixelY-this.pixelY, dist=Math.sqrt(dx*dx+dy*dy);
            if (dist<0.5) { this.pixelX=this.targetPixelX; this.pixelY=this.targetPixelY; this.isMoving=false; }
            else { const spd=getBoostedSpeed(this.moveSpeed); const step=Math.min(spd*dt,dist); this.pixelX+=(dx/dist)*step; this.pixelY+=(dy/dist)*step; }
            return;
        }

        // 跳跃打洞计时（加速阶段更快）
        this.jumpTimer -= dt;
        if (this.jumpTimer <= 0) {
            this.jumpTimer = getBoostedInterval(OWL_JUMP_INTERVAL);
            // 在脚下跳跃打洞 → 黑洞（前提：至少还有一个方向可走，避免自困）
            if (map && !isBlackHole(this.gridX, this.gridY) && this._hasEscape()) {
                const t = map.tiles[this.gridY][this.gridX];
                blackHoles.push({
                    col: this.gridX, row: this.gridY, owner: this,
                    prevColor: t.color, prevBorder: t.borderColor, prevFlipped: t.color !== map.cellColor
                });
                // 地板显示为黑色
                t.color = '#000';
                t.borderColor = '#222';
                console.log(`[Owl] 跳跃打洞 (${this.gridX},${this.gridY})`);
            }
        }

        // 低频翻板（仅翻已翻转的灰色地板，干扰玩家）
        this.flipTimer += dt;
        if (this.flipTimer >= getBoostedInterval(OWL_FLIP_INTERVAL)) {
            this.flipTimer = 0;
            if (Math.random()<OWL_FLIP_CHANCE && map && map.isTileFlipped(this.gridX,this.gridY)) {
                const t=map.tiles[this.gridY][this.gridX];
                addPendingFlip(this.gridX,this.gridY, t.color,t.borderColor,
                    map.cellColor, map.borderColor, true, getBoostedInterval(ENEMY_FLIP_DELAY));
                console.log(`[Owl] 翻回白色 (${this.gridX},${this.gridY})`);
            }
        }

        // 随机移动（不追击，跳过黑洞/石头/箱子；加速阶段更快）
        this.moveTimer += dt;
        if (this.moveTimer < getBoostedInterval(OWL_MOVE_INTERVAL)) return;
        this.moveTimer = 0;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        const valid = dirs.filter(([dx,dy]) => {
            const nx=this.gridX+dx, ny=this.gridY+dy;
            return nx>=0&&nx<COLS&&ny>=0&&ny<ROWS &&
                map&&!map.hasStone(nx,ny)&&!map.hasBox(nx,ny)&&!isBlackHole(nx,ny)&&!_isCellBlocked(nx,ny,this);
        });

        // 完全被困：传送到一个随机可通行位置
        if (valid.length === 0) {
            const freeCells = [];
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (this._canPass(c, r) && !_isCellBlocked(c, r, this)) {
                        freeCells.push([c, r]);
                    }
                }
            }
            if (freeCells.length > 0) {
                const [tc, tr] = freeCells[Math.floor(Math.random() * freeCells.length)];
                this.gridX = tc;
                this.gridY = tr;
                this.targetPixelX = OFFSET_X + tc * CELL_SIZE + BORDER_WIDTH;
                this.targetPixelY = OFFSET_Y + tr * CELL_SIZE + BORDER_WIDTH;
                this.isMoving = true;
                this.moveCooldown = 0;
                console.log(`[Owl] 困死 → 传送到 (${tc},${tr})`);
                return;
            }
        }
        
        if (valid.length>0) {
            const [dx,dy] = valid[Math.floor(Math.random()*valid.length)];
            this.gridX+=dx; this.gridY+=dy;
            this.targetPixelX=OFFSET_X+this.gridX*CELL_SIZE+BORDER_WIDTH;
            this.targetPixelY=OFFSET_Y+this.gridY*CELL_SIZE+BORDER_WIDTH;
            this.isMoving=true;
        }
    }

    // 检查脚下打洞后是否还有逃出方向
    _hasEscape() {
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        return dirs.some(([dx,dy]) => {
            const nx=this.gridX+dx, ny=this.gridY+dy;
            return nx>=0&&nx<COLS&&ny>=0&&ny<ROWS && this._canPass(nx,ny);
        });
    }
}

// ============================================
// 黑洞系统
// ============================================
function isBlackHole(col, row) {
    return blackHoles.some(bh => bh.col === col && bh.row === row);
}

// 移除某怪物创建的黑洞（死亡时恢复地板原色）
function removeBlackHolesByOwner(owner) {
    blackHoles = blackHoles.filter(bh => {
        if (bh.owner === owner) {
            // 恢复地板颜色（黑色 → 之前颜色）
            if (map && map.tiles[bh.row] && map.tiles[bh.row][bh.col]) {
                const t = map.tiles[bh.row][bh.col];
                if (bh.prevColor) t.color = bh.prevColor;
                if (bh.prevBorder) t.borderColor = bh.prevBorder;
                // 同步 flipped：始终与 color 保持一致
                t.flipped = (t.color !== map.cellColor);
            }
            return false;  // 移除该黑洞
        }
        return true;
    });
}

// ============================================
// 生成 / 击杀 / 复活
// ============================================

// 从 SPAWN_POINTS 中挑一个没有被怪物（含预警中）占用的角落；全满则返回 null
function _getFreeSpawnPoint() {
    const occupied = new Set();
    enemies.forEach(e => {
        if (e && e.alive) occupied.add(`${e.gridX},${e.gridY}`);
    });
    // 复活队列中已刷出预警怪物的也计入
    respawnQueue.filter(r => r.spawned).forEach(r => occupied.add(`${r.col},${r.row}`));
    
    const free = SPAWN_POINTS.filter(p => !occupied.has(`${p.col},${p.row}`));
    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)];
}

function spawnEnemy() {
    // 超过最大数量不生成
    const aliveCount = enemies.filter(e => e.alive && e.warning <= 0).length;
    if (aliveCount >= MAX_ENEMIES) return;
    
    // 强制类型
    if (FORCE_ENEMY_TYPE) {
        const types = {
            'Ghost': () => spawnGhost(),
            'Spider': () => spawnSpider(),
            'Snowman': () => spawnSnowman(),
            'Octopus': () => spawnOctopus(),
            'Owl': () => spawnOwl()
        };
        if (types[FORCE_ENEMY_TYPE]) {
            types[FORCE_ENEMY_TYPE]();
            return;
        }
    }
    
    // 随机生成
    const roll = Math.random();
    if (roll < 0.20) spawnGhost();
    else if (roll < 0.40) spawnSpider();
    else if (roll < 0.60) spawnSnowman();
    else if (roll < 0.80) spawnOctopus();
    else spawnOwl();
}

function spawnOwl() {
    const pt = _getFreeSpawnPoint();
    if (!pt) { console.log(`[enemy] Owl 无可用出生点，跳过`); return; }
    const o = new Owl(pt.col, pt.row);
    enemies.push(o);
    console.log(`[enemy] Owl 生成 (${pt.col},${pt.row}) 总数:${enemies.length}`);
}

function spawnOctopus() {
    const pt = _getFreeSpawnPoint();
    if (!pt) { console.log(`[enemy] Octopus 无可用出生点，跳过`); return; }
    const o = new Octopus(pt.col, pt.row);
    enemies.push(o);
    console.log(`[enemy] Octopus 生成 (${pt.col},${pt.row}) 总数:${enemies.length}`);
}

function spawnSnowman() {
    const pt = _getFreeSpawnPoint();
    if (!pt) { console.log(`[enemy] Snowman 无可用出生点，跳过`); return; }
    const s = new Snowman(pt.col, pt.row);
    enemies.push(s);
    console.log(`[enemy] Snowman 生成 (${pt.col},${pt.row}) 总数:${enemies.length}`);
}

function spawnGhost() {
    const pt = _getFreeSpawnPoint();
    if (!pt) { console.log(`[enemy] Ghost 无可用出生点，跳过`); return; }
    const g = new Ghost(pt.col, pt.row);
    enemies.push(g);
    console.log(`[enemy] Ghost 生成 (${pt.col},${pt.row}) 总数:${enemies.length}`);
}

function spawnSpider() {
    const pt = _getFreeSpawnPoint();
    if (!pt) { console.log(`[enemy] Spider 无可用出生点，跳过`); return; }
    const s = new Spider(pt.col, pt.row);
    enemies.push(s);
    console.log(`[enemy] Spider 生成 (${pt.col},${pt.row}) 总数:${enemies.length}`);
}

// 将死亡敌人加入复活队列
function killEnemy(e, immediate = false) {
    if (!e || e._killed) return;
    e._killed = true;
    e.alive = false;
    // 怪物死亡 → 移除其创建的黑洞（黑洞恢复）
    if (e.name === 'Owl') removeBlackHolesByOwner(e);
    const idx = enemies.indexOf(e);
    if (idx >= 0) enemies.splice(idx, 1);
    if (!immediate) {
        respawnQueue.push({ type: e.name, col: e.spawnCol, row: e.spawnRow, timer: ENEMY_RESPAWN_TIME, spawned: false });
        console.log(`[enemy] ${e.name} 死亡, ${ENEMY_RESPAWN_TIME/1000}s后在(${e.spawnCol},${e.spawnRow})复活`);
    }
}

// 每帧处理复活
function processRespawn(dt) {
    if (respawnQueue.length === 0) return;
    const alive = enemies.filter(e => e.alive && e.warning <= 0).length;
    if (alive >= MAX_ENEMIES) return; // 到达上限，暂停复活
    for (let i = respawnQueue.length - 1; i >= 0; i--) {
        respawnQueue[i].timer -= dt;
        if (respawnQueue[i].timer <= ENEMY_WARNING_TIME && !respawnQueue[i].spawned) {
            const rq = respawnQueue[i];
            rq.spawned = true;
            if (rq.type === 'Ghost') {
                const g = new Ghost(rq.col, rq.row); g.warning = rq.timer; enemies.push(g);
                console.log(`[enemy] Ghost 预警 (${rq.col},${rq.row}) ${Math.ceil(rq.timer/1000)}s后激活`);
            } else if (rq.type === 'Spider') {
                const s = new Spider(rq.col, rq.row); s.warning = rq.timer; enemies.push(s);
                console.log(`[enemy] Spider 预警 (${rq.col},${rq.row}) ${Math.ceil(rq.timer/1000)}s后激活`);
            } else if (rq.type === 'Snowman') {
                const s = new Snowman(rq.col, rq.row); s.warning = rq.timer; enemies.push(s);
                console.log(`[enemy] Snowman 预警 (${rq.col},${rq.row}) ${Math.ceil(rq.timer/1000)}s后激活`);
            } else if (rq.type === 'Octopus') {
                const o = new Octopus(rq.col, rq.row); o.warning = rq.timer; enemies.push(o);
                console.log(`[enemy] Octopus 预警 (${rq.col},${rq.row}) ${Math.ceil(rq.timer/1000)}s后激活`);
            } else if (rq.type === 'Owl') {
                const o = new Owl(rq.col, rq.row); o.warning = rq.timer; enemies.push(o);
                console.log(`[enemy] Owl 预警 (${rq.col},${rq.row}) ${Math.ceil(rq.timer/1000)}s后激活`);
            }
            respawnQueue.splice(i, 1);
        }
    }
}

function killAllEnemies() {
    const copy = [...enemies];
    copy.forEach(e => killEnemy(e));
}
