// ============================================
// 角色玩家类
// ============================================
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
        
        // 平滑移动
        const cx = OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
        this.pixelX = cx - this.width / 2;
        this.pixelY = cy - this.height / 2;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        this.moveSpeed = 0.35;   // 像素/ms (~250ms/格)
        
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
        if (this.invTimer > 0) return this.lives;  // 无敌中
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
    
    update(dt) {
        if (!isFinite(dt)) dt = 0;
        if (this.invTimer > 0) this.invTimer = Math.max(0, this.invTimer - dt);
        if (!this.isMoving) return;
        
        const dx = this.targetPixelX - this.pixelX;
        const dy = this.targetPixelY - this.pixelY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 0.5) {
            this.pixelX = this.targetPixelX;
            this.pixelY = this.targetPixelY;
            this.isMoving = false;
            // 滑动结束后拾取道具
            pickupItem(this.gridX, this.gridY);
        } else {
            const step = Math.min(this.moveSpeed * dt, dist);
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
    }
    
    // 更新最后移动方向
    _setDir(dx, dy) {
        if (dx !== 0 || dy !== 0) { this.lastDx = dx; this.lastDy = dy; }
    }
    
    move(dx, dy) {
        this._setDir(dx, dy);
        if (this.isMoving) return false;  // 滑动中不接受移动
        
        const newX = this.gridX + dx;
        const newY = this.gridY + dy;
        
        if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS) {
            if (map && map.hasBox(newX, newY)) {
                const result = map.pushBox(newX, newY, dx, dy);
                if (result === false) return false;
                if (result === 'destroyed') return true; // 箱子撞毁，位置不变
                // 箱子移走了，玩家进入该格
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
        if (map) {
            map.flipLine(this.gridX, this.gridY);
            return true;
        }
        return false;
    }
    
    // 重生：瞬移到起点
    respawn() {
        this.gridX = 3;
        this.gridY = 2;
        const cx = OFFSET_X + 3 * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + 2 * CELL_SIZE + CELL_SIZE / 2;
        this.pixelX = cx - this.width / 2;
        this.pixelY = cy - this.height / 2;
        this.targetPixelX = this.pixelX;
        this.targetPixelY = this.pixelY;
        this.isMoving = false;
        // 重生时丢弃手中怪物
        if (this.carriedGhost) {
            this.carriedGhost.carried = false;
            this.carriedGhost.gridX = this.gridX;
            this.carriedGhost.gridY = this.gridY;
            this.carriedGhost = null;
        }
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
            e.gridX === this.gridX && e.gridY === this.gridY);
        if (idx >= 0) {
            enemies[idx].carried = true;
            this.carriedGhost = enemies[idx];
            console.log(`[Player] 拾起硬直怪物`);
        }
    }
    
    // 投掷手中怪物
    _throwGhost() {
        const g = this.carriedGhost;
        this.carriedGhost = null;
        g.carried = false;
        
        // 设为飞行状态：直线飞出
        g.flying = true;
        g.flyDx = this.lastDx;
        g.flyDy = this.lastDy;
        g.pixelX = this.pixelX;
        g.pixelY = this.pixelY;
        g.gridX = this.gridX;
        g.gridY = this.gridY;
        console.log(`[Player] 投掷怪物 方向(${this.lastDx},${this.lastDy})`);
    }
}
