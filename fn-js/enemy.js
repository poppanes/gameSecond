// ============================================
// 敌人系统
// ============================================

// --- 全局配置 ---
let ENEMY_FLIP_DELAY = 1200;   // 翻转地板延迟(ms)
let ENEMY_MOVE_SPEED = 0.25;   // 移动速度(像素/ms)
let ENEMY_STUN_DURATION = 4000; // 硬直时长(ms)
let enemies = [];               // 所有敌人列表

// --- 各怪物生成配置 ---
const GHOST_SPAWN_POINTS = [    // Ghost 独有：仅从四角生成
    { col: 0, row: 0 },
    { col: 7, row: 0 },
    { col: 0, row: 6 },
    { col: 7, row: 6 }
];

// ============================================
// 敌人基类（寻路 / 平滑移动 / 翻板 / 碰撞 / 绘制）
// ============================================
class Enemy {
    constructor(col, row, imageSrc, name = 'enemy') {
        this.gridX = col;
        this.gridY = row;
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
        this.pushed = 0;     // 被推状态计时器(ms)，>0 时暂停自主移动
        this.stunned = 0;    // 硬直状态(ms)，>0 时显示死亡素材、不可移动
        this.carried = false; // 被玩家拾取中
        this.flying = false;  // 投掷飞行中
        this.flyDx = 0;
        this.flyDy = 0;

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
                    if (map && !map.hasStone(nx, ny) && !map.hasBox(nx, ny)) {
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

        // 飞行中：直线飞出，遇障碍消失
        if (this.flying) {
            const speed = 0.5; // 像素/ms，快速飞行
            const step = speed * dt;
            const moveX = this.flyDx * step;
            const moveY = this.flyDy * step;
            this.pixelX += moveX;
            this.pixelY += moveY;
            
            // 当前所在的粗略格
            const cx = Math.round((this.pixelX - OFFSET_X) / CELL_SIZE);
            const cy = Math.round((this.pixelY - OFFSET_Y) / CELL_SIZE);
            
            // 飞出地图边缘 → 消失
            if (this.pixelX < OFFSET_X - CELL_SIZE || 
                this.pixelX > OFFSET_X + COLS * CELL_SIZE ||
                this.pixelY < OFFSET_Y - CELL_SIZE ||
                this.pixelY > OFFSET_Y + ROWS * CELL_SIZE) {
                this.alive = false;
                const idx = enemies.indexOf(this);
                if (idx >= 0) enemies.splice(idx, 1);
                console.log(`[enemy] 飞行出地图外，消失`);
                return;
            }
            
            // 撞障碍物 → 消失
            if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
                if ((map && (map.hasStone(cx, cy) || map.hasBox(cx, cy))) ||
                    enemies.some(e => e !== this && e.alive && e.gridX === cx && e.gridY === cy)) {
                    this.alive = false;
                    const idx = enemies.indexOf(this);
                    if (idx >= 0) enemies.splice(idx, 1);
                    console.log(`[enemy] 飞行撞障碍(${cx},${cy})，消失`);
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

        // 滑行中
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
                const step = Math.min(this.moveSpeed * dt, dist);
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
        let cooldown = 300;

        // 翻回白色地板
        if (map && map.isTileFlipped(this.gridX, this.gridY)) {
            const t = map.tiles[this.gridY][this.gridX];
            addPendingFlip(this.gridX, this.gridY,
                t.color, t.borderColor,
                map.cellColor, map.borderColor,
                true, ENEMY_FLIP_DELAY);
            cooldown = ENEMY_FLIP_DELAY + 400;
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

        // 滑行中（复用基类逻辑）
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
                const step = Math.min(this.moveSpeed * dt, dist);
                this.pixelX += (dx / dist) * step;
                this.pixelY += (dy / dist) * step;
            }
            return;
        }

        if (this.moveCooldown <= 0) {
            // 优先：扫描当前和相邻格，原地翻转
            if (this._flipCurrentAndAdjacent()) {
                this.moveCooldown = ENEMY_FLIP_DELAY + 400;
                return;
            }
            // 其次：寻路到远处的已翻转地板
            const dir = this.findPath();
            if (dir) {
                const nx = this.gridX + dir.dx;
                const ny = this.gridY + dir.dy;
                // 下一格有箱子 → 不走
                if (map && map.hasBox(nx, ny)) {
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
                true, ENEMY_FLIP_DELAY);
            console.log(`[Ghost] 原地翻转当前(${this.gridX},${this.gridY})`);
            return true;
        }

        // 2) 同行左边邻格（跳过箱子）
        const left = this.gridX - 1;
        if (left >= 0 && !map.hasBox(left, this.gridY) && map.isTileFlipped(left, this.gridY)) {
            const t = map.tiles[this.gridY][left];
            addPendingFlip(left, this.gridY,
                t.color, t.borderColor, map.cellColor, map.borderColor,
                true, ENEMY_FLIP_DELAY);
            console.log(`[Ghost] 原地翻转左边(${left},${this.gridY})`);
            return true;
        }

        // 3) 同行右边邻格（跳过箱子）
        const right = this.gridX + 1;
        if (right < COLS && !map.hasBox(right, this.gridY) && map.isTileFlipped(right, this.gridY)) {
            const t = map.tiles[this.gridY][right];
            addPendingFlip(right, this.gridY,
                t.color, t.borderColor, map.cellColor, map.borderColor,
                true, ENEMY_FLIP_DELAY);
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
                    if (map && !map.hasStone(nx, ny) && !map.hasBox(nx, ny)) {
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
// 生成 / 击杀
// ============================================
function spawnGhost() {
    const pt = GHOST_SPAWN_POINTS[Math.floor(Math.random() * GHOST_SPAWN_POINTS.length)];
    const g = new Ghost(pt.col, pt.row);
    enemies.push(g);
    console.log(`[enemy] Ghost 生成在 (${pt.col},${pt.row}), 总数: ${enemies.length}`);
}

function killAllEnemies() {
    enemies.forEach(e => e.alive = false);
    enemies.length = 0;
    console.log('[enemy] 全部敌人已击杀');
}
