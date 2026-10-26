// ============================================
// 地图类
// ============================================
// 魔方连锁波浪翻转的半径（格），与 demo「连锁波浪翻转」一致（3.2）
const WAVE_RADIUS = 3.2;
// 波浪每远一格的递增延迟(ms)——与 demo 保持一致（55）；不占用全局 FLIP_DELAY/RIPPLE_STEP，避免影响翻线/翻转卡
const WAVE_STEP = 55;

// 未翻格流光边框（对标金铲铲入场 GIF，demo_border_flow.html 同参数）
// 色相场：hue = HUE_BASE + sin(u*SPACE_X + v*SPACE_Y + t*FLOW_SPD) * HUE_AMP（青 190 ~ 品红 300 流动）
const FLOW_HUE_BASE = 236;
const FLOW_HUE_AMP  = 62;
const FLOW_SPD      = 1.35;
const FLOW_SPACE_X  = 0.42;
const FLOW_SPACE_Y  = 0.55;
const FLOW_GLOW_W   = 9;     // 光晕层线宽
const FLOW_CORE_W   = 3.2;   // 白芯层线宽

class Map {
    constructor(ctx, opts = {}) {
        this.ctx = ctx;
        this.rows = ROWS;
        this.cols = COLS;
        this.cellSize = CELL_SIZE;
        this.borderWidth = BORDER_WIDTH;
        this.offsetX = OFFSET_X;
        this.offsetY = OFFSET_Y;
        
        // 地图样式配置
        this.bgColor = '#0b0b1e';          // 电玩风：深紫黑底
        this.cellColor = '#eafcff';        // 未翻：冰白（微青）
        this.borderColor = '#2f7fd6';      // 未翻边框：霓虹蓝
        
        // 地形配置（后续扩展）
        this.tiles = this.createDefaultTiles();
        
        // 翻转后颜色
        this.flippedColor = '#232848';     // 已翻：暗紫
        this.flippedBorderColor = '#101326';

        // 地板贴图：未翻 = 冰白素面（floor_front）/ 已翻 = 蓝紫底+青霓虹边（floor_back）
        // 猪头印 = 独立平滑层（pig_stamp_smooth），只叠在已翻格上，见 drawStampLayer()
        this.floorFront = new Image();
        this.floorFrontLoaded = false;
        this.floorFront.src = '../fn-image/floor_front.png';
        this.floorFront.onload = () => { this.floorFrontLoaded = true; };
        this.floorBack = new Image();
        this.floorBackLoaded = false;
        this.floorBack.src = '../fn-image/floor_back.png';
        this.floorBack.onload = () => { this.floorBackLoaded = true; };
        this.pigStamp = new Image();
        this.pigStampLoaded = false;
        this.pigStamp.src = '../fn-image/pig_stamp_smooth.png';
        this.pigStamp.onload = () => { this.pigStampLoaded = true; };
        
        // 箱子系统
        this.boxImage = new Image();
        this.boxImageLoaded = false;
        this.boxImage.src = '../fn-image/00_fx.png';   // 机台满格动画帧表 704x88 = 8 帧 @12fps
        this.boxImage.onload = () => { this.boxImageLoaded = true; };
        this.boxFrameN = 8;                            // 动画帧数
        this.boxFrameMs = 1000 / 12;                   // 12fps（定版口径）
        this.boxGrid = this.createBoxGrid();
        this.boxNeverPushed = new Set();  // 未被推动的箱子所在格，不计入通关
        this.portals = [];                // 传送门端点数组（normalizePair 生成，含 peer 互指；空 = 无传送门）
        
        // 石头系统
        this.stoneImage = new Image();
        this.stoneImageLoaded = false;
        this.stoneImage.src = '../fn-image/stone.png';
        this.stoneImage.onload = () => { this.stoneImageLoaded = true; };
        this.stoneGrid = this.createBoxGrid(); // 复用同样的二维网格创建
        
        // 墙系统（空气墙：不可通行、不可翻转、豁免通关）
        this.wallGrid = this.createBoxGrid();
        
        // 放置石头和箱子（石头先放，箱子避开石头）
        // skipDecor=true 时跳过（奖励关用 initEmpty 空地图，避免默认障碍的误导性日志与多余初始化）
        if (!opts.skipDecor) {
            this.placeStones();
            this.placeBoxes();
        }
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
        const forbidden = this._buildForbiddenSet();
        
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
    
    // 构建禁止摆放区：四角出生点 + 相邻格 + 玩家起点（随机摆放与预设布局共用）
    // includeBirthNeighbors=false 时不包含角落相邻格（用于黑洞/墙——怪进不去，不算阻塞出生点）
    _buildForbiddenSet(includeBirthNeighbors = true) {
        const forbidden = new Set([
            '0,0', `${this.cols - 1},0`, `0,${this.rows - 1}`, `${this.cols - 1},${this.rows - 1}`,  // 4个角落（怪物出生点）
            '3,3'  // 玩家起点
        ]);
        if (includeBirthNeighbors) {
            this._forbidNeighbors(forbidden, 0, 0);
            this._forbidNeighbors(forbidden, this.cols - 1, 0);
            this._forbidNeighbors(forbidden, 0, this.rows - 1);
            this._forbidNeighbors(forbidden, this.cols - 1, this.rows - 1);
        }
        return forbidden;
    }
    
    // 检查指定位置是否有石头
    hasStone(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
        return this.stoneGrid[row][col];
    }
    
    // 检查指定位置是否有墙（空气墙）
    hasWall(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
        return this.wallGrid[row][col];
    }
    
    // 放置初始箱子（避开角落+玩家起点+石头）
    placeBoxes() {
        const BOX_COUNT = 3;
        const forbidden = this._buildForbiddenSet();
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
    
    // 应用预设布局（覆盖随机摆放）。layoutData: { stones:[[列,行],...], boxes:[[列,行],...], walls:[[列,行],...], holes:[[列,行],...] }
    // 越界 / 禁区 / 石头箱子墙黑洞重叠的坐标自动跳过并告警。
    applyLayout(layoutData) {
        if (!layoutData) return;
        // 重置为全空
        this.stoneGrid = this.createBoxGrid();
        this.boxGrid = this.createBoxGrid();
        this.wallGrid = this.createBoxGrid();
        this.boxNeverPushed = new Set();
        
        const forbidden = this._buildForbiddenSet();                // 含角落相邻格（石头/箱子需要）
        const blockedForbidden = this._buildForbiddenSet(false);     // 仅角落+玩家起点（墙/黑洞用，怪本来也进不去）
        const inBounds = (c, r) => c >= 0 && c < this.cols && r >= 0 && r < this.rows;
        const stones = layoutData.stones || [];
        const boxes = layoutData.boxes || [];
        const walls = layoutData.walls || [];
        const holes = layoutData.holes || [];
        
        stones.forEach(([c, r], i) => {
            const key = `${c},${r}`;
            if (!inBounds(c, r)) { console.warn(`[applyLayout] 石头${i + 1}越界 (${c},${r})，跳过`); return; }
            if (forbidden.has(key)) { console.warn(`[applyLayout] 石头${i + 1}位于禁区 (${c},${r})，跳过`); return; }
            this.stoneGrid[r][c] = true;
            forbidden.add(key);
        });
        boxes.forEach(([c, r], i) => {
            const key = `${c},${r}`;
            if (!inBounds(c, r)) { console.warn(`[applyLayout] 箱子${i + 1}越界 (${c},${r})，跳过`); return; }
            if (forbidden.has(key)) { console.warn(`[applyLayout] 箱子${i + 1}位于禁区 (${c},${r})，跳过`); return; }
            if (this.stoneGrid[r][c]) { console.warn(`[applyLayout] 箱子${i + 1}与石头重叠 (${c},${r})，跳过`); return; }
            this.boxGrid[r][c] = true;
            this.boxNeverPushed.add(key);
            forbidden.add(key);
        });
        walls.forEach(([c, r], i) => {
            const key = `${c},${r}`;
            if (!inBounds(c, r)) { console.warn(`[applyLayout] 墙${i + 1}越界 (${c},${r})，跳过`); return; }
            if (blockedForbidden.has(key)) { console.warn(`[applyLayout] 墙${i + 1}位于禁区 (${c},${r})，跳过`); return; }
            if (this.stoneGrid[r][c]) { console.warn(`[applyLayout] 墙${i + 1}与石头重叠 (${c},${r})，跳过`); return; }
            if (this.boxGrid[r][c]) { console.warn(`[applyLayout] 墙${i + 1}与箱子重叠 (${c},${r})，跳过`); return; }
            this.wallGrid[r][c] = true;
            forbidden.add(key);
        });
        holes.forEach(([c, r], i) => {
            const key = `${c},${r}`;
            if (!inBounds(c, r)) { console.warn(`[applyLayout] 黑洞${i + 1}越界 (${c},${r})，跳过`); return; }
            if (blockedForbidden.has(key)) { console.warn(`[applyLayout] 黑洞${i + 1}位于禁区 (${c},${r})，跳过`); return; }
            if (this.stoneGrid[r][c]) { console.warn(`[applyLayout] 黑洞${i + 1}与石头重叠 (${c},${r})，跳过`); return; }
            if (this.boxGrid[r][c]) { console.warn(`[applyLayout] 黑洞${i + 1}与箱子重叠 (${c},${r})，跳过`); return; }
            if (this.wallGrid[r][c]) { console.warn(`[applyLayout] 黑洞${i + 1}与墙重叠 (${c},${r})，跳过`); return; }
            // 黑洞存于全局 blackHoles（owner: null = 地形黑洞，不会被 Owl 死亡回收）
            if (typeof blackHoles !== 'undefined') blackHoles.push({ col: c, row: r, owner: null });
            forbidden.add(key);
        });
        console.log(`[applyLayout] 石头${stones.length} 箱子${boxes.length} 墙${walls.length} 黑洞${holes.length} 已布置`);
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
        
        // 黑洞不可通行：箱子不能被推入黑洞（与墙/石头同性质）
        if (typeof isBlackHole === 'function' && isBlackHole(newCol, newRow)) {
            console.log(`[pushBox] → 目标格(${newCol},${newRow})是黑洞，箱子不能被推入`);
            return false;
        }
        // 石头或障碍物不能通行
        if (this.stoneGrid[newRow][newCol]) return false;
        if (this.wallGrid[newRow][newCol]) return false;
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
                // 玩家被推到边界/石头/箱子/黑洞 → 扣1条命（死亡动画由死亡链统一处理：1.5s 后重生 / 命尽 game over）
                player.invTimer = 0;
                player.takeDamage(1);
                console.log(`[pushBox] → 箱子把玩家推出 (${pNextCol},${pNextRow}) 玩家受伤,生命:${player.lives}`);
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
                player.boost = 1;
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
    
    // 从角色位置出发，翻转同行/同列到最近边界格子之间的所有方块
    // 双向模式（由玩家脚下格颜色决定）：
    //   正翻（脚下白格）：连线白格 → 灰，最近灰格为边界（原行为）
    //   反转（脚下灰格）：连线灰格 → 白，涟漪/翻转动画效果与正翻完全一致，最近白格为边界
    flipLine(col, row) {
        // 1. 先扫描4个方向，记录每个方向最近边界格子的位置
        const playerFlipped = this.tiles[row][col].color !== this.cellColor;
        if (typeof Sfx !== 'undefined') Sfx.play(playerFlipped ? 'flipBack' : 'flip');   // [C] 翻转音效
        const targets = [];
        const isBoundary = (c, r) => playerFlipped
            ? this.tiles[r][c].color === this.cellColor       // 反转模式：白格是边界
            : this.tiles[r][c].color !== this.cellColor;      // 正翻模式：灰格是边界

        // 左
        for (let c = col - 1; c >= 0; c--) {
            if (this.boxGrid[row][c] || this.stoneGrid[row][c] || this.wallGrid[row][c]) break; // 箱子/石头/墙阻挡
            if (typeof isBlackHole === 'function' && isBlackHole(c, row)) break; // 黑洞阻挡
            if (isBoundary(c, row)) {
                targets.push({ fromCol: col - 1, toCol: c, fromRow: row, toRow: row });
                break;
            }
        }
        // 右
        for (let c = col + 1; c < this.cols; c++) {
            if (this.boxGrid[row][c] || this.stoneGrid[row][c] || this.wallGrid[row][c]) break;
            if (typeof isBlackHole === 'function' && isBlackHole(c, row)) break; // 黑洞阻挡（原漏检，补齐）
            if (isBoundary(c, row)) {
                targets.push({ fromCol: col + 1, toCol: c, fromRow: row, toRow: row });
                break;
            }
        }
        // 上
        for (let r = row - 1; r >= 0; r--) {
            if (this.boxGrid[r][col] || this.stoneGrid[r][col] || this.wallGrid[r][col]) break;
            if (typeof isBlackHole === 'function' && isBlackHole(col, r)) break; // 黑洞阻挡
            if (isBoundary(col, r)) {
                targets.push({ fromCol: col, toCol: col, fromRow: row - 1, toRow: r });
                break;
            }
        }
        // 下
        for (let r = row + 1; r < this.rows; r++) {
            if (this.boxGrid[r][col] || this.stoneGrid[r][col] || this.wallGrid[r][col]) break;
            if (typeof isBlackHole === 'function' && isBlackHole(col, r)) break; // 黑洞阻挡
            if (isBoundary(col, r)) {
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

        // 涟漪延迟：距离越远，延迟越大；目标色统一（正翻全灰 / 反转全白）
        flipCells.forEach(({ col, row, dist }) => {
            const tile = this.tiles[row][col];
            const oldColor = tile.color;
            const oldBorder = tile.borderColor;

            const newColor = playerFlipped ? this.cellColor : this.flippedColor;
            const newBorder = playerFlipped ? this.borderColor : this.flippedBorderColor;

            const delay = FLIP_DELAY + dist * RIPPLE_STEP;
            addPendingFlip(col, row, oldColor, oldBorder, newColor, newBorder, true, delay, true);
        });
    }
    
    // 检查所有格子是否都已翻转（石头格、未推动箱子格不纳入判定）
    areAllFlipped() {
        const unflipped = [];
        const exempt = [];  // 豁免的格子
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.stoneGrid[row][col]) { exempt.push(`stone(${col},${row})`); continue; }
                if (this.wallGrid[row][col]) { exempt.push(`wall(${col},${row})`); continue; }
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
            // console.log(`[areAllFlipped] 豁免: ${exempt.join(' ')} (共${exempt.length}格)`);   // 通关检测每帧调用，屏蔽防刷屏
        }
        if (unflipped.length > 0) {
            // console.log(`[areAllFlipped] 需翻转: ${unflipped.join(' ')} (共${unflipped.length}格)`);
            return false;
        }
        // console.log(`[areAllFlipped] ✅ 全部翻转完成！`);
        return true;
    }
    
    // 检查格子是否已翻转（用颜色判定，杜绝 flipped 不同步问题）
    // 注意：黑洞格颜色为 #000（Owl 打洞），若不排除会被怪物误判为"已翻转地板"而寻路走进黑洞
    isTileFlipped(col, row) {
        if (typeof isBlackHole === 'function' && isBlackHole(col, row)) return false;
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
        if (this.hasWall(col, row)) return false;  // 墙不可通行
        if (this.hasBox(col, row)) return true;     // 箱子可被推动
        return tile.type !== 'wall' && tile.type !== 'obstacle';
    }

    // [传送门] 传送目标格可用性：仅实体障碍封锁（箱子/石头/墙/黑洞——对端被障碍占则传送门失效）
    // 怪物不封锁传送门：玩家可传送到怪物格交互（同格触发碰撞，按现有机制玩家受伤——风险自负）
    isPortalDestFree(col, row, entity = null) {
        if (!this.canMoveTo(col, row) || this.hasBox(col, row)) return false;
        return true;
    }
    
    // 奖励关卡专用：清空所有障碍物，全白地板
    initEmpty() {
        this.boxGrid = this.createBoxGrid();
        this.stoneGrid = this.createBoxGrid();
        this.wallGrid = this.createBoxGrid();
        this.boxNeverPushed = new Set();
        this.tiles = this.createDefaultTiles();
    }
    
    // 绘制地图
    draw(includeBoxes = true) {
        this.drawBackground();
        this.drawTiles(includeBoxes);
    }

    // 绘制背景
    drawBackground() {
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // 绘制所有格子
    // includeBoxes=false 时不画箱子（供渲染层做伪 3D 深度拆分：箱子按与玩家的前后关系分两层绘制）
    drawTiles(includeBoxes = true) {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                this.drawTile(col, row);
            }
        }
        this.drawFlowGrid();   // 未翻格流光边框（整网渲染，替代逐格 strokeRect）
        this.drawStones();
        if (includeBoxes) this.drawBoxes();
        this.drawWalls();
    }

    // 流光网格边框（对标金铲铲 GIF / demo_border_flow.html 同参数）：
    // 只画"至少一侧是未翻格"的网格线段；hue 场基于格点坐标连续 → 相邻段颜色自然衔接
    drawFlowGrid() {
        const t = performance.now() / 1000;
        const hue = (i, j) => FLOW_HUE_BASE + Math.sin(i * FLOW_SPACE_X + j * FLOW_SPACE_Y + t * FLOW_SPD) * FLOW_HUE_AMP;
        const hsl = (h, l, a) => "hsla(" + (((h % 360) + 360) % 360).toFixed(1) + ",95%," + (l * 100) + "%," + a + ")";
        const open = (c, r) => c >= 0 && c < this.cols && r >= 0 && r < this.rows &&
                               this.tiles[r][c].color === this.cellColor;   // 未翻格
        const passes = [
            { w: FLOW_GLOW_W, l: 0.55, a: 0.45 },   // 光晕层
            { w: FLOW_CORE_W, l: 0.78, a: 1.00 },   // 白芯层
        ];
        const ctx = this.ctx;
        ctx.save();
        ctx.lineCap = "round";
        for (const P of passes) {
            ctx.lineWidth = P.w;
            // 横向线段：格点行 r(0..rows) × 列段 c
            for (let r = 0; r <= this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    if (!open(c, r) && !open(c, r - 1)) continue;   // 两侧都非未翻 → 不画
                    const g = ctx.createLinearGradient(
                        this.offsetX + c * this.cellSize, this.offsetY + r * this.cellSize,
                        this.offsetX + (c + 1) * this.cellSize, this.offsetY + r * this.cellSize);
                    g.addColorStop(0, hsl(hue(c, r), P.l, P.a));
                    g.addColorStop(1, hsl(hue(c + 1, r), P.l, P.a));
                    ctx.strokeStyle = g;
                    ctx.beginPath();
                    ctx.moveTo(this.offsetX + c * this.cellSize + (c === 0 ? 2 : 0),
                               this.offsetY + r * this.cellSize);
                    ctx.lineTo(this.offsetX + (c + 1) * this.cellSize - (c === this.cols - 1 ? 2 : 0),
                               this.offsetY + r * this.cellSize);
                    ctx.stroke();
                }
            }
            // 纵向线段：格点列 c(0..cols) × 行段 r
            for (let c = 0; c <= this.cols; c++) {
                for (let r = 0; r < this.rows; r++) {
                    if (!open(c, r) && !open(c - 1, r)) continue;
                    const g = ctx.createLinearGradient(
                        this.offsetX + c * this.cellSize, this.offsetY + r * this.cellSize,
                        this.offsetX + c * this.cellSize, this.offsetY + (r + 1) * this.cellSize);
                    g.addColorStop(0, hsl(hue(c, r), P.l, P.a));
                    g.addColorStop(1, hsl(hue(c, r + 1), P.l, P.a));
                    ctx.strokeStyle = g;
                    ctx.beginPath();
                    ctx.moveTo(this.offsetX + c * this.cellSize,
                               this.offsetY + r * this.cellSize + (r === 0 ? 2 : 0));
                    ctx.lineTo(this.offsetX + c * this.cellSize,
                               this.offsetY + (r + 1) * this.cellSize - (r === this.rows - 1 ? 2 : 0));
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }
    
    // 十字翻转（翻转卡·粉）：自身 + 上下左右四邻（障碍格跳过）
    flipCross(col, row) {
        const cells = [{ col, row, playerTile: true, dist: 0 }];
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dc, dr], i) => {
            const c = col + dc, r = row + dr;
            if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
            if (this.boxGrid[r][c] || this.stoneGrid[r][c] || this.wallGrid[r][c]) return;
            if (typeof isBlackHole === 'function' && isBlackHole(c, r)) return;
            cells.push({ col: c, row: r, playerTile: false, dist: 1 + i * 0.2 });
        });
        cells.forEach(({ col, row, playerTile, dist }) => {
            const tile = this.tiles[row][col];
            const oldColor = tile.color;
            const oldBorder = tile.borderColor;
            let newColor, newBorder;
            if (playerTile) {
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

    // 连锁波浪翻转（魔方）：以中心格为原点，半径 WAVE_RADIUS 格内按欧氏距离递增延迟依次翻转
    // 障碍格（箱/石/墙/黑洞）跳过；中心格取 toggle，其余统一翻成已翻色
    flipWave(col, row) {
        const R = WAVE_RADIUS;
        let cells = 0;
        for (let r = row - Math.ceil(R); r <= row + Math.ceil(R); r++) {
            if (r < 0 || r >= this.rows) continue;
            for (let c = col - Math.ceil(R); c <= col + Math.ceil(R); c++) {
                if (c < 0 || c >= this.cols) continue;
                const d = Math.hypot(c - col, r - row);
                if (d > R) continue;
                if (this.boxGrid[r][c] || this.stoneGrid[r][c] || this.wallGrid[r][c]) continue;
                if (typeof isBlackHole === 'function' && isBlackHole(c, r)) continue;
                const tile = this.tiles[r][c];
                const oldColor = tile.color;
                const oldBorder = tile.borderColor;
                // 与 demo onFlipLand 一致：每格都取反（已翻的翻回白格，未翻的翻成暗紫）
                const isFlipped = tile.color !== this.cellColor;
                const newColor = isFlipped ? this.cellColor : this.flippedColor;
                const newBorder = isFlipped ? this.borderColor : this.flippedBorderColor;
                addPendingFlip(c, r, oldColor, oldBorder, newColor, newBorder, isFlipped,
                               d * WAVE_STEP, true);
                cells++;
            }
        }
        console.log(`[Item] 魔方连锁波浪：中心(${col},${row}) 半径 ${R} 格 → ${cells} 格依次翻转`);
        return cells;
    }

    // 绘制所有石头（满格：88 素材整格覆盖，偏移 0，连边框区一起盖住）
    drawStones() {
        if (!this.stoneImageLoaded) return;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.stoneGrid[row][col]) {
                    const x = this.offsetX + col * this.cellSize;
                    const y = this.offsetY + row * this.cellSize;
                    this.ctx.drawImage(this.stoneImage, x, y, this.cellSize, this.cellSize);
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

    // 箱子伪 3D 深度分层绘制：above=true 画"格底 >= thresholdY"的近景箱（遮挡玩家下半身）；
    // above=false 画"格底 < thresholdY"的远景箱（被玩家遮挡）。thresholdY = 玩家 sprite 底部 y（绝对屏幕坐标）
    drawBoxesSplit(thresholdY, above) {
        if (!this.boxImageLoaded) return;
        for (let row = 0; row < this.rows; row++) {
            const boxBottom = this.offsetY + (row + 1) * this.cellSize;   // 绝对屏幕坐标，与 thresholdY 同基准
            if ((boxBottom >= thresholdY) !== above) continue;
            for (let col = 0; col < this.cols; col++) {
                if (this.boxGrid[row][col]) this.drawBox(col, row);
            }
        }
    }
    
    // 绘制单个箱子（满格 88 + 屏幕动画：帧表 8 帧 @12fps 循环）
    drawBox(col, row) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;
        const f = Math.floor(performance.now() / this.boxFrameMs) % this.boxFrameN;
        this.ctx.drawImage(this.boxImage, f * this.cellSize, 0, this.cellSize, this.cellSize, x, y, this.cellSize, this.cellSize);
    }
    
    // 绘制所有墙（空气墙）
    drawWalls() {
        if (!WALL_VISIBLE) return;  // 空气墙完全不可见
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.wallGrid[row][col]) {
                    this.drawWall(col, row);
                }
            }
        }
    }
    
    // 绘制单个墙（半透明可视化，便于编辑调试）
    drawWall(col, row) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;
        // 半透明填充
        this.ctx.fillStyle = 'rgba(90, 160, 255, 0.22)';
        this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
        // 边框
        this.ctx.strokeStyle = 'rgba(90, 160, 255, 0.75)';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(x, y, this.cellSize, this.cellSize);
        // 对角斜线标识
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + this.cellSize, y + this.cellSize);
        this.ctx.moveTo(x + this.cellSize, y);
        this.ctx.lineTo(x, y + this.cellSize);
        this.ctx.strokeStyle = 'rgba(90, 160, 255, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
    
    // 绘制单个格子
    drawTile(col, row) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;
        const tile = this.tiles[row][col];
        const isFlipped = tile.color !== this.cellColor;

        if (!isFlipped) {
            // 未翻格：贴冰白素面 + 方形同心深紫渐变（与 demo drawArcadeTileFace 未翻分支同口径）
            if (this.floorFrontLoaded) {
                this.ctx.drawImage(this.floorFront, x, y, this.cellSize, this.cellSize);
            } else {
                this.ctx.fillStyle = tile.color;
                this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
            }
            // 方形同心渐变：由外向内 18 层矩形插值（等值线贴合方形边框）
            const w = this.cellSize, h = this.cellSize;
            const cx2 = x + w * 0.5, cy2 = y + h * 0.5;
            const C_IN  = [65, 18, 150];   // 中心·深紫（#41129A）
            const C_OUT = [72,  0, 128];   // 边缘·深紫（#480080）
            const SQ_LAYERS = 18;
            for (let i = 0; i < SQ_LAYERS; i++) {
                const f = i / (SQ_LAYERS - 1);            // 0(最外) → 1(最内)
                const s = f * f * (3 - 2 * f);            // smoothstep
                const scale = 1 - f * 0.98;
                const halfW = (w * 0.5) * scale;
                const halfH = (h * 0.5) * scale;
                const rr = Math.round(C_OUT[0] + (C_IN[0] - C_OUT[0]) * s);
                const gg = Math.round(C_OUT[1] + (C_IN[1] - C_OUT[1]) * s);
                const bb = Math.round(C_OUT[2] + (C_IN[2] - C_OUT[2]) * s);
                this.ctx.fillStyle = 'rgba(' + rr + ',' + gg + ',' + bb + ',1.00)';
                this.ctx.fillRect(cx2 - halfW, cy2 - halfH, halfW * 2, halfH * 2);
            }
        } else {
            // 已翻格：蓝紫底 + 青霓虹边贴图；未加载回退程序绘制
            if (this.floorBackLoaded) {
                this.ctx.drawImage(this.floorBack, x, y, this.cellSize, this.cellSize);
            } else {
                this.ctx.fillStyle = tile.color;
                this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
            }
        }

        // 边框：已翻格保留描边（贴图外沿强调）；未翻格由 drawFlowGrid 流光线替代
        if (isFlipped) {
            this.ctx.strokeStyle = tile.borderColor;
            this.ctx.lineWidth = this.borderWidth;
            this.ctx.strokeRect(x, y, this.cellSize, this.cellSize);
        }
    }

    // 猪头印平滑层：只叠在"已翻格"上（与 demo drawStampOverlay 同口径）
    // 用平滑缩放 + 同色柔阴影，让 1px 细线在实机读起来实心；猪头印不随像素格缩放
    drawStampLayer() {
        if (!this.pigStampLoaded) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 0.95;
        ctx.shadowColor = 'rgba(97,159,204,0.90)';
        ctx.shadowBlur = 2;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const tile = this.tiles[row][col];
                if (tile.color === this.cellColor) continue;   // 只画已翻格
                ctx.drawImage(this.pigStamp,
                    this.offsetX + col * this.cellSize, this.offsetY + row * this.cellSize,
                    this.cellSize, this.cellSize);
                // 炸弹格：猪头纹路染红（#e94560 为奖励关炸弹专属色，普通关无此色格 → 天然只在奖励关生效）
                if (tile.color === '#e94560') {
                    ctx.save();
                    ctx.globalAlpha = 0.55;
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = '#e94560';
                    ctx.fillRect(this.offsetX + col * this.cellSize, this.offsetY + row * this.cellSize,
                        this.cellSize, this.cellSize);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    // ===== 传送门（通用门对模型：行/列/不对等传送；levels.js 可选配置，15 回合内不配置）=====
    // 配置：portals: [{ a: [0,2], b: [7,5] }, { a: [3,0], b: [3,6] }, { a: [0,5], b: [4,3] }, ...]
    //   每对双向互通；端点在边缘（col 0/7、row 0/6）时触发方向自动推导（左门按左、顶门按上...）
    //   端点在内部格 = 单向出口（只进不出，出口朝向 = 穿门方向延续）；可显式给 { col, row, enter, face }
    setPortals(cfg) {
        if (!Array.isArray(cfg)) { this.portals = []; return; }
        // 旧行格式兼容：[2, 5] → 每行生成左右对称水平门对
        if (cfg.length > 0 && cfg.every(x => typeof x === 'number')) {
            this.portals = [];
            cfg.forEach(r => {
                const pair = this._normalizePair({ a: [0, r], b: [this.cols - 1, r] });
                if (pair) this.portals.push(...pair);
            });
            return;
        }
        this.portals = [];
        cfg.forEach(p => {
            const pair = this._normalizePair(p);
            if (pair) this.portals.push(...pair);
        });
    }
    // 兼容接口：行数组 → 左右对称水平门对（测试地图 KeyP 使用）
    setPortalRows(rows) {
        this.setPortals(Array.isArray(rows) ? rows.filter(r => Number.isInteger(r)) : []);
    }
    isPortalRow(row) { return this.portals.some(p => p.row === row); }
    _normEnd(end) {
        const col = Array.isArray(end) ? end[0] : end.col;
        const row = Array.isArray(end) ? end[1] : end.row;
        if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        let enter = Array.isArray(end.enter) ? end.enter : null;
        const face = Array.isArray(end.face) ? end.face : null;
        if (!enter) {
            if (col === 0) enter = [-1, 0];
            else if (col === this.cols - 1) enter = [1, 0];
            else if (row === 0) enter = [0, -1];
            else if (row === this.rows - 1) enter = [0, 1];
        }
        return { col, row, enter, face };
    }
    _normalizePair(p) {
        if (!p || !p.a || !p.b) return null;
        const A = this._normEnd(p.a);
        const B = this._normEnd(p.b);
        if (!A || !B) return null;
        // 出口朝向：默认 = 对端 enter 的反向（穿门后沿原方向走出）；对端为内部单向出口时 = 自身 enter 反向
        A.face = A.face || (B.enter ? [-B.enter[0], -B.enter[1]] : (A.enter ? [-A.enter[0], -A.enter[1]] : [1, 0]));
        B.face = B.face || (A.enter ? [-A.enter[0], -A.enter[1]] : (B.enter ? [-B.enter[0], -B.enter[1]] : [-1, 0]));
        const pa = { col: A.col, row: A.row, enter: A.enter, face: A.face };
        const pb = { col: B.col, row: B.row, enter: B.enter, face: B.face };
        pa.peer = pb; pb.peer = pa;   // 互相指向对端（传送目标）
        return [pa, pb];
    }
    // 玩家传送查询：站格 + 移动方向精确匹配端点 enter → 返回对端 { col, row, face }
    findPortal(col, row, dx, dy) {
        for (const p of this.portals) {
            if (p.col === col && p.row === row && p.enter &&
                p.enter[0] === dx && p.enter[1] === dy) {
                return { col: p.peer.col, row: p.peer.row, face: p.peer.face };
            }
        }
        return null;
    }
    // 怪物传送查询：站格即穿（方向不限；内部单向出口端无 enter 不触发）
    findPortalAt(col, row) {
        for (const p of this.portals) {
            if (p.col === col && p.row === row && p.enter) {
                return { col: p.peer.col, row: p.peer.row };
            }
        }
        return null;
    }
    // 是否为可触发的门端点（有 enter 的端点；内部单向出口端无 enter 不算）
    isPortalEnd(col, row) {
        return this.portals.some(p => p.col === col && p.row === row && p.enter);
    }
    _portalEdge(p) {
        if (p.col === 0) return 'left';
        if (p.col === this.cols - 1) return 'right';
        if (p.row === 0) return 'top';
        if (p.row === this.rows - 1) return 'bottom';
        return null;   // 内部端（单向出口）
    }
    // 绘制编排：边缘端画边框外门区（水平=左右/垂直=上下），内部端画格内漩涡标记
    drawPortals(now) {
        if (!this.portals.length) return;
        const ctx = this.ctx;
        ctx.save();
        const doorW = 44, doorH = this.cellSize - 10;
        this.portals.forEach(p => {
            const edge = this._portalEdge(p);
            const cx = this.offsetX + p.col * this.cellSize + this.cellSize / 2;
            const cy = this.offsetY + p.row * this.cellSize + this.cellSize / 2;
            const pulse = 0.5 + 0.5 * Math.sin(now / 260 + p.col + p.row);
            // 对端被占（箱子/石头/墙/黑洞/怪物）→ 门区红色提示（传送失效；推走后自动恢复）
            const destFree = this.isPortalDestFree(p.peer.col, p.peer.row, null);
            if (edge === 'left' || edge === 'right') {
                const x0 = edge === 'left' ? this.offsetX - doorW - 4 : this.offsetX + GRID_WIDTH + 4;
                const tip = edge === 'left' ? 1 : -1;
                this._drawDoorH(ctx, x0, cy - doorH / 2, doorW, doorH, now, tip, pulse, destFree);
            } else if (edge === 'top' || edge === 'bottom') {
                const y0 = edge === 'top' ? this.offsetY - doorH - 4 : this.offsetY + GRID_HEIGHT + 4;
                const tip = edge === 'top' ? 1 : -1;
                this._drawDoorV(ctx, cx - (this.cellSize - 10) / 2, y0, this.cellSize - 10, doorH, now, tip, pulse, destFree);
            } else {
                this._drawPortalMark(ctx, cx, cy, now, pulse);   // 内部单向出口：格内标记
            }
        });
        ctx.restore();
    }
    // 水平门区（左右边缘）：底光 + 描边 + 光点 + chevron（尖朝地图内）；destFree=false 对端被占 → 红色描边提示
    _drawDoorH(ctx, x0, y0, doorW, doorH, now, tip, pulse, destFree = true) {
        const cy = y0 + doorH / 2;
        const ccx = x0 + doorW / 2;
        const grad = ctx.createRadialGradient(ccx, cy, 3, ccx, cy, doorW * 0.72);
        grad.addColorStop(0, `rgba(0,229,255,${(0.45 + pulse * 0.25).toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(122,60,255,${(0.26 + pulse * 0.16).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(122,60,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y0, doorW, doorH);
        ctx.strokeStyle = destFree ? 'rgba(0,229,255,0.4)' : 'rgba(233,69,96,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y0, doorW, doorH);
        for (let i = 0; i < 3; i++) {
            const a = now / (340 + i * 90) + i * (Math.PI * 2 / 3) + (tip > 0 ? 0 : Math.PI);
            const px = ccx + Math.cos(a) * 13;
            const py = cy + Math.sin(a) * (doorH / 4);
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = i % 2 === 0 ? '#00e5ff' : '#ffd700';
            ctx.beginPath();
            ctx.arc(px, py, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        const blink = 0.5 + 0.5 * Math.sin(now / 280);
        ctx.globalAlpha = 0.35 + 0.65 * blink;
        ctx.strokeStyle = '#eafcff';
        ctx.lineWidth = 3;
        for (let i = 0; i < 2; i++) {
            const cx = tip === 1 ? x0 + doorW - 12 - i * 14 : x0 + 12 + i * 14;
            ctx.beginPath();
            ctx.moveTo(cx - 6 * tip, cy - 11);
            ctx.lineTo(cx + 6 * tip, cy);
            ctx.lineTo(cx - 6 * tip, cy + 11);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    // 垂直门区（上下边缘）：底光 + 描边 + 光点 + chevron（上门▼尖朝下 / 下门▲尖朝上）；destFree=false → 红色描边
    _drawDoorV(ctx, x0, y0, doorW, doorH, now, tip, pulse, destFree = true) {
        const cx = x0 + doorW / 2;
        const ccy = y0 + doorH / 2;
        const grad = ctx.createRadialGradient(cx, ccy, 3, cx, ccy, doorH * 0.72);
        grad.addColorStop(0, `rgba(0,229,255,${(0.45 + pulse * 0.25).toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(122,60,255,${(0.26 + pulse * 0.16).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(122,60,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y0, doorW, doorH);
        ctx.strokeStyle = destFree ? 'rgba(0,229,255,0.4)' : 'rgba(233,69,96,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y0, doorW, doorH);
        for (let i = 0; i < 3; i++) {
            const a = now / (340 + i * 90) + i * (Math.PI * 2 / 3) + (tip > 0 ? 0 : Math.PI);
            const px = cx + Math.cos(a) * (doorW / 4);
            const py = ccy + Math.sin(a) * 13;
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = i % 2 === 0 ? '#00e5ff' : '#ffd700';
            ctx.beginPath();
            ctx.arc(px, py, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        const blink = 0.5 + 0.5 * Math.sin(now / 280);
        ctx.globalAlpha = 0.35 + 0.65 * blink;
        ctx.strokeStyle = '#eafcff';
        ctx.lineWidth = 3;
        for (let i = 0; i < 2; i++) {
            const cyy = tip === 1 ? y0 + doorH - 12 - i * 14 : y0 + 12 + i * 14;
            ctx.beginPath();
            ctx.moveTo(cx - 11, cyy - 6 * tip);
            ctx.lineTo(cx, cyy + 6 * tip);
            ctx.lineTo(cx + 11, cyy - 6 * tip);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    // 内部单向出口的格内标记：低透明度脉动漩涡圈
    _drawPortalMark(ctx, cx, cy, now, pulse) {
        ctx.save();
        ctx.globalAlpha = 0.4 + pulse * 0.3;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5ff';
        ctx.fill();
        ctx.restore();
    }
}
