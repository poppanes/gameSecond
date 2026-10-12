// ============================================
// 角色玩家类
// ============================================
// 行走步态同步：每格播放的行走帧数（8帧完整步态跨约2.7格，帧率约13fps，贴近素材设计节奏）
const PIG_WALK_FRAMES_PER_CELL = 3;
// 行走衔接宽限(ms)：跨格续走时视为仍在行走，避免步态相位被打断
const WALK_GRACE_MS = 100;

class Player {
    constructor(gridX, gridY) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.width = 66;
        this.height = 66;
        
        // 素材配置
        this.useImage = false;
        this.image = null;
        this.color = '#ff4444';

        // 方块猪帧表素材（v3：walk 8帧 / push 4帧 / pick 5帧，88px 单帧，原始朝右）
        this.pigSheets = { walk: null, push: null, pushL: null, pick: null };
        this.pigReady = false;
        this._loadPigSheets();
        this.face = 'right';       // 朝向（原始帧朝右，左=镜像翻转）
        this.pickStart = 0;        // 拾取动作起始时刻（550ms 单次播放）
        this.pushStart = 0;        // 推箱动作起始时刻（260ms）
        this.walkTime = 0;         // 行走帧时钟：随移动累积，与位移速度锁定（步态连贯）
        this.lastWalkAt = 0;       // 最近一次行走累积时刻（跨格衔接宽限用）
        
        // 平滑移动
        const cx = OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
        this.pixelX = cx - this.width / 2;
        this.pixelY = cy - this.height / 2;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        this.moveSpeed = 0.40;   // 像素/ms (~220ms/格，平衡值：略快于怪物但不过分)
        this.boost = 1;          // 转向加速倍率（input 检测到转向意图时临时提高，走完本格自动重置）
        this.lastMoveDir = null; // 上一次移动方向（用于判断转向）
        
        // 生命值（初始 2 条命，死亡一次扣 1）
        this.lives = 2;
        this.invTimer = 0;  // 受伤后短暂无敌(ms)
        
        // 方向追踪（用于投掷怪物方向）
        this.lastDx = 0;
        this.lastDy = -1;  // 默认朝上
        
        // 拾取硬直怪物
        this.carriedGhost = null;
    }
    
    // 受到伤害（死亡一次扣除一次数值），无敌中免疫伤害
    takeDamage(amount = 1) {
        if (this.invTimer > 0) return this.lives;  // 无敌中免疫（不刷新计时器）
        this.lives = Math.max(0, this.lives - amount);
        this.invTimer = 800;  // 受伤后 800ms 无敌
        return this.lives;
    }
    
    isDead() { return this.lives <= 0; }
    
    setImage(imageSrc) {
        this.image = new Image();
        this.image.src = imageSrc;
        this.image.onload = () => { this.useImage = true; };
    }

    // 加载方块猪 v3 帧表（与 demo art-upgrade-demo 同一套素材）
    _loadPigSheets() {
        const defs = {
            walk:  '../fn-image/pig_v3_walk_8.png',      // 8 帧循环，原始朝右
            push:  '../fn-image/pig_v3_push_4.png',      // 4 帧循环，推·右
            pushL: '../fn-image/pig_v3_push_left_4.png', // 4 帧循环，推·左（镜像件）
            pick:  '../fn-image/pig_v3_pick_5.png',      // 5 帧单次，蹲下→起身
        };
        let n = 0;
        const total = Object.keys(defs).length;
        for (const k in defs) {
            const img = new Image();
            this.pigSheets[k] = img;
            img.onload = () => { if (++n === total) this.pigReady = true; };
            img.src = defs[k];
        }
    }

    // 方块猪帧表绘制；返回 false = 素材未就绪（回退旧绘制分支）
    _drawPig(ctx, x, y) {
        const now = performance.now();
        const FW = 88, W = this.width, H = this.height;
        let img, frame = 0, flip = false;
        if (this.pickStart && now - this.pickStart < 550) {          // 拾取：5 帧单次
            img = this.pigSheets.pick;
            frame = Math.min(4, Math.floor((now - this.pickStart) / 110));
        } else if (this.pushStart && now - this.pushStart < 260) {   // 推箱：4 帧循环（>滑动时长盖全程）
            img = this.face === 'left' ? this.pigSheets.pushL : this.pigSheets.push;
            frame = Math.floor((now - this.pushStart) / 65) % 4;   // 从推箱起点计时，260ms 走完 4 帧（一整步态）
        } else if (this.isMoving || now - this.lastWalkAt < WALK_GRACE_MS) {   // 行走：8 帧循环（帧钟与位移同步，跨格相位连续）
            img = this.pigSheets.walk;
            const frameMs = (CELL_SIZE / this.moveSpeed) / PIG_WALK_FRAMES_PER_CELL;   // 每帧时长随移动速度自动同步
            frame = Math.floor(this.walkTime / frameMs) % 8;
            flip = this.face === 'left';
        } else {                                                     // 驻立：行走第 0 帧
            img = this.pigSheets.walk;
            flip = this.face === 'left';
        }
        if (!img || !img.complete || !img.naturalWidth) return false;
        ctx.save();
        ctx.imageSmoothingEnabled = false;   // 像素画缩放禁用平滑
        if (flip) {
            ctx.translate(x + W, y);
            ctx.scale(-1, 1);
            ctx.drawImage(img, frame * FW, 0, FW, FW, 0, 0, W, H);
        } else {
            ctx.drawImage(img, frame * FW, 0, FW, FW, x, y, W, H);
        }
        ctx.restore();
        return true;
    }
    
    update(dt) {
        if (!isFinite(dt)) dt = 0;
        // 无敌倒计时（不移动时也要更新）
        if (this.invTimer > 0) this.invTimer = Math.max(0, this.invTimer - dt);
        // 行走帧时钟：仅移动时累积；转向加速(boost)时步频同步加快，步幅与实际位移严格同步
        if (this.isMoving) {
            this.walkTime += dt * (this.boost || 1);
            this.lastWalkAt = performance.now();
        }
        if (!this.isMoving) return;
        
        const dx = this.targetPixelX - this.pixelX;
        const dy = this.targetPixelY - this.pixelY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 0.5) {
            this.pixelX = this.targetPixelX;
            this.pixelY = this.targetPixelY;
            this.isMoving = false;
            this.boost = 1;   // 本格结束，重置加速
            // 滑动结束后拾取道具
            pickupItem(this.gridX, this.gridY);
        } else {
            // 转向时按 boost 倍率加速走完本格，缩短转向延迟（位置仍连续，无跳变）
            const step = Math.min(this.moveSpeed * this.boost * dt, dist);
            this.pixelX += (dx / dist) * step;
            this.pixelY += (dy / dist) * step;
        }
    }
    
    draw(ctx) {
        const x = this.pixelX;
        const y = this.pixelY;
        
        // 无敌闪烁
        if (this.invTimer > 0 && Math.floor(this.invTimer / 100) % 2 === 0) {
            ctx.globalAlpha = 0.4;
        }

        // 方块猪帧表渲染（素材加载完成时优先，回退到旧的单图/程序绘制）
        if (this.pigReady && this._drawPig(ctx, x, y)) {
            ctx.globalAlpha = 1;
            return;
        }

        if (this.useImage && this.image && this.image.complete) {
            ctx.drawImage(this.image, x, y, this.width, this.height);
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(x, y, this.width, this.height);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 40px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('^_^', x + this.width / 2, y + this.height / 2);
        }
        ctx.globalAlpha = 1;
    }
    
    // 设置目标格子（滑动中不接受新输入）
    _commitMove(newGridX, newGridY) {
        this.gridX = newGridX;
        this.gridY = newGridY;
        const cx = OFFSET_X + newGridX * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + newGridY * CELL_SIZE + CELL_SIZE / 2;
        this.targetPixelX = cx - this.width / 2;
        this.targetPixelY = cy - this.height / 2;
        this.isMoving = true;
        this.boost = 1;   // 新格从正常速度起步
        // 驻立后起步：行走帧时钟归零，从触地帧开始迈步（起步帧确定，不再随机跳帧）
        if (performance.now() - this.lastWalkAt > WALK_GRACE_MS) this.walkTime = 0;
    }
    
    // 更新最后移动方向（含方块猪朝向：左右更新，上下保持）
    _setDir(dx, dy) {
        if (dx !== 0 || dy !== 0) { this.lastDx = dx; this.lastDy = dy; }
        if (dx > 0) this.face = 'right';
        if (dx < 0) this.face = 'left';
    }
    
    move(dx, dy) {
        this._setDir(dx, dy);
        if (this.isMoving) return false;  // 滑动中不接受移动
        this.lastMoveDir = { dx, dy };    // 记录本次方向（供转向判断）
        
        const newX = this.gridX + dx;
        const newY = this.gridY + dy;
        
        if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS) {
            if (map && map.hasBox(newX, newY)) {
                const result = map.pushBox(newX, newY, dx, dy);
                if (result === false) return false;
                if (result === 'destroyed') return true; // 箱子撞毁，位置不变
                // 兜底：箱子被消除/移走后，玩家进入该格前再校验黑洞（防止推箱顺势进入黑洞格）
                if (typeof isBlackHole === 'function' && isBlackHole(newX, newY)) return false;
                // 箱子移走了，玩家进入该格
                this.pushStart = performance.now();   // 方块猪：播放推箱帧
                this._commitMove(newX, newY);
                return true;
            } else if (map && !map.canMoveTo(newX, newY)) {
                return false;
            }
            this._commitMove(newX, newY);
            return true;
        }
        return false;
    }
    
    flipCurrentTile() {
        // 奖励关卡：翻牌逻辑交给 game.js
        if (game && game.bonusMode && game.bonusPhase === 'playing') {
            game.onBonusFlip(this.gridX, this.gridY);
            return true;
        }
        if (map) {
            map.flipLine(this.gridX, this.gridY);
            return true;
        }
        return false;
    }
    
    // 重生：瞬移到起点 + 无敌闪烁
    respawn() {
        const oldX = this.gridX;
        const oldY = this.gridY;
        const oldPx = this.pixelX;
        const oldPy = this.pixelY;
        
        // 手中怪物从原位飞出去死亡（不再原地丢弃）
        if (this.carriedGhost) {
            const g = this.carriedGhost;
            g.carried = false;
            g.flying = true;
            g.moveSpeed = THROW_FLY_SPEED;
            g.flyDx = this.lastDx;
            g.flyDy = this.lastDy;
            g.pixelX = oldPx;
            g.pixelY = oldPy;
            g.gridX = oldX;
            g.gridY = oldY;
            this.carriedGhost = null;
            console.log(`[Player] 受伤，手中怪物飞出 (${g.flyDx},${g.flyDy})`);
        }
        
        this.gridX = 3;
        this.gridY = 2;
        const cx = OFFSET_X + 3 * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + 2 * CELL_SIZE + CELL_SIZE / 2;
        this.pixelX = cx - this.width / 2;
        this.pixelY = cy - this.height / 2;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        this.boost = 1;          // 重生后重置加速
        this.invTimer = 2000;  // 重生后 2 秒无敌
    }
    
    // 拾取/投掷硬直怪物（K键）
    interactGhost() {
        if (this.isMoving) return;
        
        // 手中已有怪物 → 投掷
        if (this.carriedGhost) {
            this._throwGhost();
            return;
        }
        
        // 拾取：脚下有硬直怪物？
        if (!enemies) return;
        const idx = enemies.findIndex(e => e && e.alive && e.stunned > 0 &&
            this._canPickupStunned(e));
        if (idx >= 0) {
            enemies[idx].carried = true;
            this.carriedGhost = enemies[idx];
            this.pickStart = performance.now();   // 方块猪：播放拾取帧
            console.log(`[Player] 拾起硬直怪物`);
        }
    }
    
    // 判断能否拾取硬直怪物：逻辑同格，或显示区域与玩家当前格重叠（处理卡在两个格子中间的情况）
    _canPickupStunned(e) {
        // 1) 严格逻辑同格
        if (e.gridX === this.gridX && e.gridY === this.gridY) return true;
        
        // 2) 显示区域与玩家当前格重叠（怪物在滑动中被击停时会卡在两个格子之间）
        const px = OFFSET_X + this.gridX * CELL_SIZE;
        const py = OFFSET_Y + this.gridY * CELL_SIZE;
        const size = e.size || (CELL_SIZE - BORDER_WIDTH * 2);
        return e.pixelX < px + CELL_SIZE && e.pixelX + size > px &&
               e.pixelY < py + CELL_SIZE && e.pixelY + size > py;
    }
    
    // 投掷手中怪物
    _throwGhost() {
        const g = this.carriedGhost;
        this.carriedGhost = null;
        g.carried = false;
        
        // 设为飞行状态：直线飞出
        g.flying = true;
        g.moveSpeed = THROW_FLY_SPEED;  // 飞行速度
        g.flyDx = this.lastDx;
        g.flyDy = this.lastDy;
        g.pixelX = this.pixelX;
        g.pixelY = this.pixelY;
        g.gridX = this.gridX;
        g.gridY = this.gridY;
        console.log(`[Player] 投掷怪物 方向(${this.lastDx},${this.lastDy})`);
    }
}
