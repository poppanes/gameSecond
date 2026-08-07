// ============================================
// 地图类
// ============================================
class Map {
    constructor(ctx) {
        this.ctx = ctx;
        this.rows = ROWS;
        this.cols = COLS;
        this.cellSize = CELL_SIZE;
        this.borderWidth = BORDER_WIDTH;
        this.offsetX = OFFSET_X;
        this.offsetY = OFFSET_Y;
        
        // 地图样式配置
        this.bgColor = '#16213e';
        this.cellColor = '#fffbff';
        this.borderColor = '#a5a2a5';
        
        // 地形配置（后续扩展）
        this.tiles = this.createDefaultTiles();
        
        // 翻转后颜色
        this.flippedColor = '#a5a2a5';
        this.flippedBorderColor = '#525152';
        
        // 箱子系统
        this.boxImage = new Image();
        this.boxImageLoaded = false;
        this.boxImage.src = '../fn-image/00.png';
        this.boxImage.onload = () => { this.boxImageLoaded = true; };
        this.boxGrid = this.createBoxGrid();
        this.boxNeverPushed = new Set();  // 未被推动的箱子所在格，不计入通关
        
        // 石头系统
        this.stoneImage = new Image();
        this.stoneImageLoaded = false;
        this.stoneImage.src = '../fn-image/stone.png';
        this.stoneImage.onload = () => { this.stoneImageLoaded = true; };
        this.stoneGrid = this.createBoxGrid(); // 复用同样的二维网格创建
        
        // 放置石头和箱子（石头先放，箱子避开石头）
        this.placeStones();
        this.placeBoxes();
    }
    
    // 创建箱子二维网格
    createBoxGrid() {
        const grid = [];
        for (let r = 0; r < this.rows; r++) {
            grid[r] = new Array(this.cols).fill(false);
        }
        return grid;
    }
    
    // 放置石头（避开角落怪物出生点 + 相邻格 + 玩家起点）
    placeStones() {
        const STONE_COUNT = 2;
        const forbidden = new Set([
            '0,0', '7,0', '0,6', '7,6',  // 4个角落（怪物出生点）
            '3,2'                          // 玩家起点
        ]);
        // 角落相邻格也禁止（防止堵死怪物）
        this._forbidNeighbors(forbidden, 0, 0);
        this._forbidNeighbors(forbidden, 7, 0);
        this._forbidNeighbors(forbidden, 0, 6);
        this._forbidNeighbors(forbidden, 7, 6);
        
        for (let i = 0; i < STONE_COUNT; i++) {
            let col, row, key;
            let attempts = 0;
            do {
                col = Math.floor(Math.random() * this.cols);
                row = Math.floor(Math.random() * this.rows);
                key = `${col},${row}`;
                attempts++;
                if (attempts > 200) break;
            } while (forbidden.has(key) || this.stoneGrid[row][col]);
            
            this.stoneGrid[row][col] = true;
            forbidden.add(key);
            console.log(`[placeStones] 石头${i+1}: (${col},${row})`);
        }
    }
    
    // 辅助：将 (col,row) 四邻加入禁止集
    _forbidNeighbors(set, col, row) {
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        dirs.forEach(([dx, dy]) => {
            const nx = col + dx, ny = row + dy;
            if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
                set.add(`${nx},${ny}`);
            }
        });
    }
    
    // 检查指定位置是否有石头
    hasStone(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
        return this.stoneGrid[row][col];
    }
    
    // 放置初始箱子（避开角落+玩家起点+石头）
    placeBoxes() {
        const BOX_COUNT = 3;
        const forbidden = new Set([
            '0,0', '7,0', '0,6', '7,6',  // 4个角落（Ghost出生点）
            '3,2'                          // 玩家起点
        ]);
        // 仅禁止角落的直接相邻格（防止Ghost被堵死）
        this._forbidNeighbors(forbidden, 0, 0);
        this._forbidNeighbors(forbidden, 7, 0);
        this._forbidNeighbors(forbidden, 0, 6);
        this._forbidNeighbors(forbidden, 7, 6);
        // 添加石头位置到禁止列表
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.stoneGrid[r][c]) forbidden.add(`${c},${r}`);
            }
        }
        
        let placed = 0;
        for (let i = 0; i < BOX_COUNT; i++) {
            let col, row, key;
            let attempts = 0;
            do {
                col = Math.floor(Math.random() * this.cols);
                row = Math.floor(Math.random() * this.rows);
                key = `${col},${row}`;
                attempts++;
                if (attempts > 500) break;
            } while (forbidden.has(key) || this.boxGrid[row][col]);
            
            if (attempts > 500) {
                console.warn(`[placeBoxes] 箱子${i+1} 无可用位置，跳过`);
                continue;
            }
            this.boxGrid[row][col] = true;
            this.boxNeverPushed.add(key);
            forbidden.add(key);
            placed++;
            console.log(`[placeBoxes] 箱子${i+1} (实际第${placed}个): (${col},${row})`);
        }
        if (placed < BOX_COUNT) {
            console.warn(`[placeBoxes] 最终仅生成了 ${placed}/${BOX_COUNT} 个箱子`);
        }
    }
    
    // 检查指定位置是否有箱子
    hasBox(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
        return this.boxGrid[row][col];
    }
    
    // 推箱子：返回 true=箱子移动/玩家可前进，'destroyed'=箱子撞毁/玩家不动，false=推不动
    pushBox(boxCol, boxRow, dx, dy) {
        const newCol = boxCol + dx;
        const newRow = boxRow + dy;
        
        console.log(`[pushBox] 推箱子 (${boxCol},${boxRow}) 方向(${dx},${dy}) → 目标(${newCol},${newRow})`);
        
        // 箱子被推动，原位置不再享受"免翻转"豁免
        this.boxNeverPushed.delete(`${boxCol},${boxRow}`);
        
        // 边界：不可推出地图
        if (newCol < 0 || newCol >= this.cols || newRow < 0 || newRow >= this.rows) {
            console.log(`[pushBox] → 碰到边界，推不动`);
            return false;
        }
        
        // 条件A：推到的格子上有另一个箱子 → 当前箱子消失 → 掉落道具 → 玩家不前进
        if (this.boxGrid[newRow][newCol]) {
            console.log(`[pushBox] → 撞到另一个箱子，当前箱子消失，玩家不移动`);
            this.boxGrid[boxRow][boxCol] = false;
            spawnItem(boxCol, boxRow);
            return 'destroyed';
        }
        
        // 条件C：目标位置有怪物（硬直中不算）
        const enemiesOnCell = enemies.filter(e => e && e.alive === true && e.stunned <= 0 &&
            e.gridX === newCol && e.gridY === newRow);
        if (enemiesOnCell.length > 0) {
            const eNextCol = newCol + dx;
            const eNextRow = newRow + dy;
            const eOutOfBounds = eNextCol < 0 || eNextCol >= this.cols || eNextRow < 0 || eNextRow >= this.rows;
            const eNextStone = !eOutOfBounds && this.stoneGrid[eNextRow][eNextCol];
            const eNextHole = !eOutOfBounds && typeof isBlackHole === 'function' && isBlackHole(eNextCol, eNextRow);
            
            // 推动方向是边界/石头/黑洞 → 目标格所有怪物死亡
            if (eOutOfBounds || eNextStone || eNextHole) {
                this.boxGrid[boxRow][boxCol] = false;
                const newCorner = (newCol === 0 || newCol === this.cols - 1) &&
                                   (newRow === 0 || newRow === this.rows - 1);
                if (newCorner) {
                    spawnItem(newCol, newRow, true);
                    console.log(`[pushBox] → 推到角落(${newCol},${newRow})，箱子消失`);
                } else {
                    this.boxGrid[newRow][newCol] = true;
                }
                enemiesOnCell.forEach(e => { e.alive = false; });
                console.log(`[pushBox] → 箱子把 [${enemiesOnCell.map(e=>e.name).join(',')}] 共${enemiesOnCell.length}只怪物推出地图外`);
                return true;
            }
            
            // 怪物在边界内：检测下一格是否可通行 → 推动到下一格
            const e = enemiesOnCell[0];
            const canPush = !this.boxGrid[eNextRow][eNextCol] &&
                !enemies.some(other => other !== e && other.alive &&
                    other.gridX === eNextCol && other.gridY === eNextRow);
            if (canPush) {
                this.boxGrid[boxRow][boxCol] = false;
                this.boxGrid[newRow][newCol] = true;
                e.pushTo(eNextCol, eNextRow);
                console.log(`[pushBox] → 箱子推动 ${e.name} (${newCol},${newRow}) → (${eNextCol},${eNextRow})`);
                // 同一格有多余怪物 → 也推出（极端情况，保底处理）
                if (enemiesOnCell.length > 1) {
                    for (let i = 1; i < enemiesOnCell.length; i++) {
                        enemiesOnCell[i].alive = false;
                    }
                    console.log(`[pushBox] → 同一格多余 ${enemiesOnCell.length - 1} 只怪物被推出`);
                }
                return true;
            }
            console.log(`[pushBox] → 怪物推不动，箱子也无法移动`);
            return false;
        }
        
        // 石头或障碍物不能通行
        if (this.stoneGrid[newRow][newCol]) return false;
        if (this.tiles[newRow][newCol].type === 'wall' || this.tiles[newRow][newCol].type === 'obstacle') return false;
        
        // 条件D：目标位置有玩家 → 推动玩家（可能推出地图致死）
        if (typeof player !== 'undefined' && player.gridX === newCol && player.gridY === newRow) {
            const pNextCol = newCol + dx;
            const pNextRow = newRow + dy;
            const pNextOutOfBounds = pNextCol < 0 || pNextCol >= this.cols || pNextRow < 0 || pNextRow >= this.rows;
            const pNextStone = !pNextOutOfBounds && this.stoneGrid[pNextRow][pNextCol];
            const pNextBox = !pNextOutOfBounds && this.boxGrid[pNextRow][pNextCol];
            const pNextHole = !pNextOutOfBounds && typeof isBlackHole === 'function' && isBlackHole(pNextCol, pNextRow);
            
            // 移动箱子到玩家位置
            this.boxGrid[boxRow][boxCol] = false;
            this.boxGrid[newRow][newCol] = true;
            
            if (pNextOutOfBounds || pNextStone || pNextBox || pNextHole) {
                // 玩家被推到边界/石头/箱子/黑洞 → 扣1条命
                player.invTimer = 0;
                player.takeDamage(1);
                player.respawn();
                console.log(`[pushBox] → 箱子把玩家推出 (${pNextCol},${pNextRow}) 玩家受伤,生命:${player.lives}`);
                if (player.isDead()) {
                    if (game) { game.gameOver = true; if (gameInput) gameInput.enabled = false; }
                }
            } else {
                // 玩家被推到下一格（无伤害）
                player.gridX = pNextCol;
                player.gridY = pNextRow;
                const pcx = OFFSET_X + pNextCol * CELL_SIZE + CELL_SIZE / 2;
                const pcy = OFFSET_Y + pNextRow * CELL_SIZE + CELL_SIZE / 2;
                player.pixelX = pcx - player.width / 2;
                player.pixelY = pcy - player.height / 2;
                player.targetPixelX = player.pixelX;
                player.targetPixelY = player.pixelY;
                player.isMoving = false;
                console.log(`[pushBox] → 箱子推动玩家 (${newCol},${newRow}) → (${pNextCol},${pNextRow})`);
            }
            
            // 统一角落检测：箱子到达角落也消失+掉落
            const isCorner = (newCol === 0 || newCol === this.cols - 1) &&
                             (newRow === 0 || newRow === this.rows - 1);
            if (isCorner) {
                this.boxGrid[newRow][newCol] = false;
                spawnItem(newCol, newRow, true);
                console.log(`[pushBox] → 到达角落(${newCol},${newRow})，箱子消失`);
            } else {
                this.boxNeverPushed.add(`${newCol},${newRow}`);
            }
            return true;
        }
        
        // 移动箱子
        this.boxGrid[boxRow][boxCol] = false;
        this.boxGrid[newRow][newCol] = true;
        
        // 条件B：到达4个角落 → 箱子自动消失 → 必定掉落道具
        const isCorner = (newCol === 0 || newCol === this.cols - 1) &&
                         (newRow === 0 || newRow === this.rows - 1);
        if (isCorner) {
            this.boxGrid[newRow][newCol] = false;
            spawnItem(newCol, newRow, true);
            console.log(`[pushBox] → 到达角落(${newCol},${newRow})，箱子消失`);
        } else {
            this.boxNeverPushed.add(`${newCol},${newRow}`);
        }
        return true;
    }
    
    // 尝试推箱子（从玩家方向）：成功返回 true
    tryPushBox(playerCol, playerRow, dx, dy) {
        const boxCol = playerCol + dx;
        const boxRow = playerRow + dy;
        
        if (!this.hasBox(boxCol, boxRow)) return false;
        return this.pushBox(boxCol, boxRow, dx, dy);
    }
    
    // 创建默认格子数据
    createDefaultTiles() {
        const tiles = [];
        for (let row = 0; row < this.rows; row++) {
            tiles[row] = [];
            for (let col = 0; col < this.cols; col++) {
                tiles[row][col] = {
                    type: 'normal',  // normal, wall, obstacle...
                    color: this.cellColor,
                    borderColor: this.borderColor,
                    flipped: false   // 是否已翻转
                };
            }
        }
        return tiles;
    }
    
    // 翻转指定格子
    flipTile(col, row) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            const tile = this.tiles[row][col];
            const isCurrentlyFlipped = tile.color !== this.cellColor;
            const newFlipped = !isCurrentlyFlipped;
            tile.color = newFlipped ? this.flippedColor : this.cellColor;
            tile.borderColor = newFlipped ? this.flippedBorderColor : this.borderColor;
            tile.flipped = newFlipped;  // 同步（兼容旧代码）
            return newFlipped;
        }
        return false;
    }
    
    // 强制翻转指定格子（不切换状态）
    forceFlipTile(col, row) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            const tile = this.tiles[row][col];
            tile.flipped = true;
            tile.color = this.flippedColor;
            tile.borderColor = this.flippedBorderColor;
        }
    }
    
    // 从角色位置出发，翻转同行/同列到最近已翻转格子之间的所有方块
    flipLine(col, row) {
        // 1. 先扫描4个方向，记录每个方向最近已翻转格子的位置
        const targets = [];
        
        // 左
        for (let c = col - 1; c >= 0; c--) {
            if (this.boxGrid[row][c] || this.stoneGrid[row][c]) break; // 箱子/石头阻挡
            if (typeof isBlackHole === 'function' && isBlackHole(c, row)) break; // 黑洞阻挡
            if (this.tiles[row][c].color !== this.cellColor) {
                targets.push({ fromCol: col - 1, toCol: c, fromRow: row, toRow: row });
                break;
            }
        }
        // 右
        for (let c = col + 1; c < this.cols; c++) {
            if (this.boxGrid[row][c] || this.stoneGrid[row][c]) break;
            if (this.tiles[row][c].color !== this.cellColor) {
                targets.push({ fromCol: col + 1, toCol: c, fromRow: row, toRow: row });
                break;
            }
        }
        // 上
        for (let r = row - 1; r >= 0; r--) {
            if (this.boxGrid[r][col] || this.stoneGrid[r][col]) break;
            if (typeof isBlackHole === 'function' && isBlackHole(col, r)) break; // 黑洞阻挡
            if (this.tiles[r][col].color !== this.cellColor) {
                targets.push({ fromCol: col, toCol: col, fromRow: row - 1, toRow: r });
                break;
            }
        }
        // 下
        for (let r = row + 1; r < this.rows; r++) {
            if (this.boxGrid[r][col] || this.stoneGrid[r][col]) break;
            if (typeof isBlackHole === 'function' && isBlackHole(col, r)) break; // 黑洞阻挡
            if (this.tiles[r][col].color !== this.cellColor) {
                targets.push({ fromCol: col, toCol: col, fromRow: row + 1, toRow: r });
                break;
            }
        }
        
        // 收集所有需要翻转的格子（含角色自身，带距离）
        const flipCells = [{ col, row, playerTile: true, dist: 0 }];
        
        targets.forEach(({ fromCol, toCol, fromRow, toRow }) => {
            if (fromRow === toRow) {
                const step = toCol > fromCol ? 1 : -1;
                for (let c = fromCol; step > 0 ? c < toCol : c > toCol; c += step) {
                    flipCells.push({
                        col: c, row: fromRow, playerTile: false,
                        dist: Math.abs(c - col)
                    });
                }
            } else {
                const step = toRow > fromRow ? 1 : -1;
                for (let r = fromRow; step > 0 ? r < toRow : r > toRow; r += step) {
                    flipCells.push({
                        col: toCol, row: r, playerTile: false,
                        dist: Math.abs(r - row)
                    });
                }
            }
        });
        
        // 涟漪延迟：距离越远，延迟越大
        flipCells.forEach(({ col, row, playerTile, dist }) => {
            const tile = this.tiles[row][col];
            const oldColor = tile.color;
            const oldBorder = tile.borderColor;
            
            let newColor, newBorder;
            if (playerTile) {
                // 用实际颜色判断（不用 tile.flipped，避免怪物翻转导致 flipped 与颜色不同步）
                const isFlipped = tile.color !== this.cellColor;
                newColor = isFlipped ? this.cellColor : this.flippedColor;
                newBorder = isFlipped ? this.borderColor : this.flippedBorderColor;
            } else {
                newColor = this.flippedColor;
                newBorder = this.flippedBorderColor;
            }
            
            const delay = FLIP_DELAY + dist * RIPPLE_STEP;
            addPendingFlip(col, row, oldColor, oldBorder, newColor, newBorder, playerTile, delay, true);
        });
    }
    
    // 检查所有格子是否都已翻转（石头格、未推动箱子格不纳入判定）
    areAllFlipped() {
        const unflipped = [];
        const exempt = [];  // 豁免的格子
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.stoneGrid[row][col]) { exempt.push(`stone(${col},${row})`); continue; }
                if (this.boxNeverPushed.has(`${col},${row}`)) { exempt.push(`box(${col},${row})`); continue; }
                // 黑洞格豁免（无法翻转）
                if (typeof isBlackHole === 'function' && isBlackHole(col, row)) { exempt.push(`hole(${col},${row})`); continue; }
                // 用颜色判断，避免 flipped/color 不同步
                const tile = this.tiles[row][col];
                if (tile.color === this.cellColor) {
                    unflipped.push(`(${col},${row})`);
                }
            }
        }
        if (exempt.length > 0) {
            console.log(`[areAllFlipped] 豁免: ${exempt.join(' ')} (共${exempt.length}格)`);
        }
        if (unflipped.length > 0) {
            console.log(`[areAllFlipped] 需翻转: ${unflipped.join(' ')} (共${unflipped.length}格)`);
            return false;
        }
        console.log(`[areAllFlipped] ✅ 全部翻转完成！`);
        return true;
    }
    
    // 检查格子是否已翻转（用颜色判定，杜绝 flipped 不同步问题）
    isTileFlipped(col, row) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            return this.tiles[row][col].color !== this.cellColor;
        }
        return false;
    }
    
    // 设置指定格子类型
    setTile(col, row, type, color = null) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            this.tiles[row][col] = {
                type: type,
                color: color || this.cellColor,
                borderColor: this.borderColor,
                flipped: false
            };
        }
    }
    
    // 获取指定格子类型
    getTile(col, row) {
        if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
            return this.tiles[row][col];
        }
        return null;
    }
    
    // 判断格子是否可通行（箱子由 player.move 处理推逻辑，石头不可通行）
    canMoveTo(col, row) {
        const tile = this.getTile(col, row);
        if (!tile) return false;
        if (typeof isBlackHole === 'function' && isBlackHole(col, row)) return false; // 黑洞不可通行
        if (this.hasStone(col, row)) return false; // 石头不可通行
        if (this.hasBox(col, row)) return true;     // 箱子可被推动
        return tile.type !== 'wall' && tile.type !== 'obstacle';
    }
    
    // 奖励关卡专用：清空所有障碍物，全白地板
    initEmpty() {
        this.boxGrid = this.createBoxGrid();
        this.stoneGrid = this.createBoxGrid();
        this.boxNeverPushed = new Set();
        this.tiles = this.createDefaultTiles();
    }
    
    // 绘制地图
    draw() {
        this.drawBackground();
        this.drawTiles();
    }
    
    // 绘制背景
    drawBackground() {
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    
    // 绘制所有格子
    drawTiles() {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                this.drawTile(col, row);
            }
        }
        this.drawStones();
        this.drawBoxes();
    }
    
    // 绘制所有石头
    drawStones() {
        if (!this.stoneImageLoaded) return;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.stoneGrid[row][col]) {
                    const x = this.offsetX + col * this.cellSize + this.borderWidth;
                    const y = this.offsetY + row * this.cellSize + this.borderWidth;
                    const size = this.cellSize - this.borderWidth * 2;
                    this.ctx.drawImage(this.stoneImage, x, y, size, size);
                }
            }
        }
    }
    
    // 绘制所有箱子
    drawBoxes() {
        if (!this.boxImageLoaded) return;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.boxGrid[row][col]) {
                    this.drawBox(col, row);
                }
            }
        }
    }
    
    // 绘制单个箱子（占满格子内部）
    drawBox(col, row) {
        const x = this.offsetX + col * this.cellSize + this.borderWidth;
        const y = this.offsetY + row * this.cellSize + this.borderWidth;
        const size = this.cellSize - this.borderWidth * 2;
        this.ctx.drawImage(this.boxImage, x, y, size, size);
    }
    
    // 绘制单个格子
    drawTile(col, row) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;
        const tile = this.tiles[row][col];
        
        // 格子填充
        this.ctx.fillStyle = tile.color;
        this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
        
        // 边框
        this.ctx.strokeStyle = tile.borderColor;
        this.ctx.lineWidth = this.borderWidth;
        this.ctx.strokeRect(x, y, this.cellSize, this.cellSize);
    }
}
