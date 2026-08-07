// ============================================
// 翻转动画管理
// ============================================
const animations = [];
const pendingFlips = [];
let lastTime = 0;

// 翻转延迟时间(ms)，可修改用于测试
let FLIP_DELAY = 500;
let RIPPLE_STEP = 80;  // 涟漪每格递增延迟(ms)，0=同时翻，越大越明显

// 清空所有动画和延迟队列（重启游戏时调用）
function clearAllFlips() {
    animations.length = 0;
    pendingFlips.length = 0;
    lastTime = 0;
}

// 检查是否还有翻转动画/延迟翻转在执行中
function hasActiveFlips() {
    return pendingFlips.length > 0 || animations.length > 0;
}

// 添加翻转动画
function addFlipAnimation(col, row, oldColor, oldBorderColor, newColor, newBorderColor) {
    animations.push({
        col, row,
        oldColor, oldBorderColor,
        newColor, newBorderColor,
        progress: 0,
        duration: 300,
        active: true
    });
}

// 添加延迟翻转（先不改变格子状态，延迟后执行翻转+动画）
function addPendingFlip(col, row, oldColor, oldBorderColor, newColor, newBorderColor, toggle, delay, fromPlayer = false) {
    pendingFlips.push({
        col, row,
        oldColor, oldBorderColor,
        newColor, newBorderColor,
        toggle, delay,
        elapsed: 0,
        fromPlayer
    });
}

// 更新延迟翻转队列
function updatePendingFlips(dt) {
    for (let i = pendingFlips.length - 1; i >= 0; i--) {
        const pf = pendingFlips[i];
        if (!pf) continue;
        pf.elapsed += dt;
        if (pf.elapsed >= pf.delay) {
            // 执行翻转：改变格子状态
            const tile = map.tiles[pf.row][pf.col];
            tile.color = pf.newColor;
            tile.borderColor = pf.newBorderColor;
            // flipped 与颜色始终保持同步（修复怪物翻转造成的状态不一致）
            tile.flipped = (pf.newColor !== map.cellColor);
            
            // 翻板执行时，仅玩家翻转 → 怪物进入硬直状态（不立即消失）
            if (pf.fromPlayer && typeof enemies !== 'undefined') {
                for (let j = enemies.length - 1; j >= 0; j--) {
                    if (enemies[j] && enemies[j].alive === true && enemies[j].stunned <= 0 &&
                        enemies[j].gridX === pf.col && enemies[j].gridY === pf.row) {
                        enemies[j].stunned = ENEMY_STUN_DURATION;
                        console.log(`[flip] 玩家翻转击晕怪物(${pf.col},${pf.row}) ${ENEMY_STUN_DURATION/1000}秒后恢复`);
                    }
                }
            }
            
            // 同时播放翻转动画
            addFlipAnimation(pf.col, pf.row, pf.oldColor, pf.oldBorderColor, pf.newColor, pf.newBorderColor);
            
            pendingFlips.splice(i, 1);
        }
    }
}

// 更新所有动画
function updateAnimations(dt) {
    for (let i = animations.length - 1; i >= 0; i--) {
        const anim = animations[i];
        if (!anim.active) {
            animations.splice(i, 1);
            continue;
        }
        anim.progress += dt / anim.duration;
        if (anim.progress >= 1) {
            anim.active = false;
            animations.splice(i, 1);
        }
    }
}

// 获取当前帧时间差
function getDeltaTime(timestamp) {
    if (lastTime === 0) lastTime = timestamp;
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    return Math.min(dt, 50);
}

// 绘制所有翻转动画
function drawFlipAnimations() {
    animations.forEach(anim => {
        const cx = OFFSET_X + anim.col * CELL_SIZE + CELL_SIZE / 2;
        const cy = OFFSET_Y + anim.row * CELL_SIZE + CELL_SIZE / 2;
        
        const p = anim.progress;
        const angle = p * Math.PI;          // 0 → π
        const cosVal = Math.cos(angle);     // 1 → -1
        const scaleY = Math.abs(cosVal);    // 1 → 0 → 1
        
        // 当前面/背面
        const showFront = p < 0.5;
        const color = showFront ? anim.oldColor : anim.newColor;
        const borderColor = showFront ? anim.oldBorderColor : anim.newBorderColor;
        
        const w = CELL_SIZE;
        const h = CELL_SIZE * scaleY;
        const x = cx - w / 2;
        const y = cy - h / 2;
        
        // --- 绘制翻转的木板 ---
        
        // 木板主体
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        
        // 木板边框
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = BORDER_WIDTH;
        ctx.strokeRect(x, y, w, h);
        
        // --- 侧边厚度效果（翻转过半时露出一条边）---
        if (scaleY < 0.5 && scaleY > 0.05) {
            const edgeY = cosVal > 0 ? y + h : y;
            const edgeH = BORDER_WIDTH * (1 - scaleY * 2);
            
            ctx.fillStyle = showFront ? '#8b7d7b' : '#6b5b59';
            ctx.fillRect(x + 2, cosVal > 0 ? y + h : y - edgeH, w - 4, edgeH);
        }
        
        // --- 阴影渐变（增加立体感）---
        if (scaleY > 0.05) {
            const grad = ctx.createLinearGradient(
                x, cosVal > 0 ? y : y + h,
                x, cosVal > 0 ? y + h : y
            );
            if (showFront) {
                // 正面：底部渐暗
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(1, 'rgba(0,0,0,0.25)');
            } else {
                // 背面：顶部渐暗
                grad.addColorStop(0, 'rgba(0,0,0,0.25)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
            }
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, w, h);
        }
        
        // --- 中间折痕线（完全立起时）---
        if (scaleY < 0.15) {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(cx - CELL_SIZE / 2 + 4, cy - 2, CELL_SIZE - 8, 4);
        }
    });
}
