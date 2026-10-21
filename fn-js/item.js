// ============================================
// 道具系统
// ============================================
const items = [];

// 道具类型定义（2026-10-12 补给类换皮：樱桃→香蕉 / 苹果→橙子 / 桃子→火龙果，与素材包定版对齐）
const ITEM_TYPES = {
    banana:    { name: '香蕉',    src: '../fn-image/item/banana.png',      category: 'fruit',  score: 100 },
    orange:    { name: '橙子',    src: '../fn-image/item/orange.png',      category: 'fruit',  score: 200 },
    dragonfruit:{ name: '火龙果', src: '../fn-image/item/dragonfruit.png', category: 'fruit',  score: 400 },
    watermelon:{ name: '西瓜',    src: '../fn-image/item/watermelon.png',  category: 'fruit',  score: 800 },
    icecream:  { name: '雪糕饮料', src: '../fn-image/item/icecream.png',   category: 'fruit',  score: 5000 },
    time:      { name: '沙漏',  src: '../fn-image/item/time.png',        category: 'time',   score: 0,
                 particles: 'cyan' },
    hammer:    { name: '铁锤',  src: '../fn-image/item/hammer.png',      category: 'hammer', score: 0 },
    heart:     { name: '爱心',  src: '../fn-image/heath.png',            category: 'heart',  score: 0,
                 particles: 'pink' },
    boom:      { name: '炸弹',  src: '../fn-image/boom.png',             category: 'boom',   score: 0 },
    // 实用类功能语义（2026-10-13）：翻转卡=两行横翻/三列纵翻，雪花=全体怪物冰冻8s
    flip1:     { name: '翻转卡·青', src: '../fn-image/item/flip1.png',    category: 'flip',   score: 0,
                 particles: 'cyan' },   // 拾取=随机两行整行横翻（不要求相邻）
    flip2:     { name: '翻转卡·粉', src: '../fn-image/item/flip2.png',    category: 'flip',   score: 0,
                 particles: 'pink' },   // 拾取=随机3列整列纵翻（优先未翻转的列，不要求相邻）
    cube:      { name: '魔方',  src: '../fn-image/item/cube.png',        category: 'cube',   score: 0,
                 sheet: '../fn-image/item/cube_spin.png', sheetN: 36, sheetMs: 3000/36 },  // 360° 旋转帧表：单一 1× = 3s/圈（定版口径）；拾取=连锁波浪翻转（半径 3.2 格，按距离递增延迟）
    snowflake: { name: '雪花',  src: '../fn-image/item/snowflake.png',   category: 'snow',   score: 0,
                 particles: 'cyan' },   // 拾取=全体怪物冰冻 8s（铁锤 4s 的强化版）
};

// 粒子动效配置（上升式口径：crystal_cube 素材 24px，三档缩放 12/16/20，单格内容域内循环上升）
const PARTICLE_STYLES = {
    cyan: ['../fn-image/particle/cyan_1.png', '../fn-image/particle/cyan_2.png', '../fn-image/particle/cyan_3.png'],
    pink: ['../fn-image/particle/pink_1.png', '../fn-image/particle/pink_2.png', '../fn-image/particle/pink_3.png'],
};
const PARTICLE_COUNT = 10;
const PARTICLE_SIZES = [12, 16, 20];       // 三档显示尺寸（24px 素材缩放）
const PARTICLE_VY = [0.018, 0.028, 0.040]; // 上升速度档（px/ms，与尺寸档对应：大粒快）

// 水果类型列表（用于随机）
const FRUIT_TYPES = ['dragonfruit', 'orange', 'banana', 'watermelon', 'icecream'];

// 生命值上限
const MAX_LIVES = 5;

// ============================================
// 道具类
// ============================================
class Item {
    constructor(type, col, row) {
        this.type = type;
        this.gridX = col;
        this.gridY = row;
        this.width = CELL_SIZE - BORDER_WIDTH * 2;
        this.height = CELL_SIZE - BORDER_WIDTH * 2;
        
        this.image = new Image();
        this.imageLoaded = false;
        this.image.src = ITEM_TYPES[type].src;
        this.image.onload = () => { this.imageLoaded = true; };

        // 动效帧表（可选）：如魔方 360° 旋转
        const info = ITEM_TYPES[type];
        this.sheetLoaded = false;
        if (info.sheet) {
            this.sheet = new Image();
            this.sheet.src = info.sheet;
            this.sheet.onload = () => { this.sheetLoaded = true; };
        }

        // 粒子动效（可选）：crystal_cube 上升式，画在本体之后（被压住=光从道具后滑过）
        this.particles = null;
        this._lastT = 0;
        if (info.particles && PARTICLE_STYLES[info.particles]) {
            const imgs = PARTICLE_STYLES[info.particles].map(src => {
                const im = new Image(); im.src = src; return im;
            });
            this.particleImgs = imgs;
            this.particles = [];
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const k = i % 3;   // 三档尺寸/速度
                this.particles.push({
                    img: imgs[k],
                    size: PARTICLE_SIZES[k],
                    vy: PARTICLE_VY[k],
                    ox: 8 + Math.random() * (this.width - 16 - PARTICLE_SIZES[k]),  // 内容域内水平位置（固定）
                    y: Math.random() * this.height,                                  // 初始相位随机（避免同帧启动）
                });
            }
        }
    }

    // 粒子推进+绘制（在格子坐标系：x0,y0 = 格内容域左上）
    drawParticles(ctx, x0, y0, now) {
        const dt = this._lastT ? Math.min(50, now - this._lastT) : 16;
        this._lastT = now;
        for (const p of this.particles) {
            if (!p.img.complete || !p.img.naturalWidth) continue;
            p.y -= p.vy * dt;
            if (p.y < -p.size) p.y = this.height;          // 越顶回卷到底
            ctx.drawImage(p.img, x0 + p.ox, y0 + p.y, p.size, p.size);
        }
    }

    draw(ctx) {
        const x = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
        const y = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
        const now = performance.now();
        // 粒子先画（被本体压住）
        if (this.particles) this.drawParticles(ctx, x, y, now);
        if (this.sheetLoaded) {
            // 帧表动效：全局钟循环取帧（64px 单帧 → 76 内容域）
            const info = ITEM_TYPES[this.type];
            const f = Math.floor(now / info.sheetMs) % info.sheetN;
            ctx.drawImage(this.sheet, f * 64, 0, 64, 64, x, y, this.width, this.height);
            return;
        }
        if (!this.imageLoaded) return;
        ctx.drawImage(this.image, x, y, this.width, this.height);
    }
    
    // 拾取效果
    onPickup() {
        const info = ITEM_TYPES[this.type];
        switch (info.category) {
            case 'fruit':
                if (game && game.addScore) {
                    game.addScore(info.score);
                }
                break;
            case 'time':
                if (game && game.timeLeft) {
                    game.timeLeft += 10 * 1000;  // +10秒
                    if (game.timeLeft > GAME_DURATION) game.timeLeft = GAME_DURATION;
                }
                break;
            case 'hammer':
                // 铁锤：所有怪物进入硬直状态（不立即死亡）；重生闪烁预警中的怪物无敌豁免
                if (typeof enemies !== 'undefined') {
                    enemies.forEach(e => {
                        if (e && e.alive && (e.warning || 0) <= 0) {
                            e.stunned = ENEMY_STUN_DURATION;
                            console.log(`[Item] 铁锤击晕 ${e.name} (${e.gridX},${e.gridY})`);
                        }
                    });
                }
                break;
            case 'heart':
                // 爱心：生命值 +1（上限 MAX_LIVES）
                if (player && typeof player.lives !== 'undefined') {
                    player.lives = Math.min(MAX_LIVES, player.lives + 1);
                    console.log(`[Item] 爱心 +1 生命，当前生命: ${player.lives}`);
                }
                break;
            case 'boom':
                // 炸弹：击杀所有怪物
                if (typeof killAllEnemies === 'function') {
                    killAllEnemies();
                    console.log(`[Item] 炸弹击杀全部怪物`);
                }
                break;
            case 'flip':
                // 翻转卡：flip1=相邻两行整行横翻；flip2=相邻3列整列纵翻
                // 优先级：靠近已翻转格的白格先翻（涟漪从已有灰色区域向外蔓延），无已翻转格时以玩家位置为起点
                if (player && map) {
                    if (this.type === 'flip1') {
                        // 随机两行：优先"未翻转的行"（行内含白格），白行不足 2 行时从其余行随机补足；去重
                        const whiteRows = [], otherRows = [];
                        for (let r = 0; r < ROWS; r++) {
                            let hasWhite = false;
                            for (let c = 0; c < COLS && !hasWhite; c++) {
                                if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.hasBox(c, r)) continue;
                                if (typeof isBlackHole === 'function' && isBlackHole(c, r)) continue;
                                const tile = map.tiles[r][c];
                                if (tile && tile.color === map.cellColor) hasWhite = true;
                            }
                            (hasWhite ? whiteRows : otherRows).push(r);
                        }
                        whiteRows.sort(() => Math.random() - 0.5);   // 白行随机洗牌
                        otherRows.sort(() => Math.random() - 0.5);
                        const rows = whiteRows.slice(0, 2)
                            .concat(otherRows.slice(0, 2 - whiteRows.length));
                        console.log(`[Item] 翻转卡·青：随机翻转第 ${rows[0]} 行与第 ${rows[1]} 行（优先未翻转行）`);
                        rows.forEach(r => flipRowInstant(r, player.gridX));
                    } else {
                        // 随机 3 列：优先"未翻转的列"（列内含白格），白列不足 3 列时从其余列随机补足；去重
                        const whiteCols = [], otherCols = [];
                        for (let c = 0; c < COLS; c++) {
                            let hasWhite = false;
                            for (let r = 0; r < ROWS && !hasWhite; r++) {
                                if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.hasBox(c, r)) continue;
                                if (typeof isBlackHole === 'function' && isBlackHole(c, r)) continue;
                                const tile = map.tiles[r][c];
                                if (tile && tile.color === map.cellColor) hasWhite = true;
                            }
                            (hasWhite ? whiteCols : otherCols).push(c);
                        }
                        whiteCols.sort(() => Math.random() - 0.5);   // 白列随机洗牌
                        otherCols.sort(() => Math.random() - 0.5);
                        const cols = whiteCols.slice(0, 3)
                            .concat(otherCols.slice(0, 3 - whiteCols.length));
                        console.log(`[Item] 翻转卡·粉：随机翻转第 ${cols.join('/')} 列（优先未翻转列）`);
                        cols.forEach(c => flipColInstant(c, player.gridY));
                    }
                }
                break;
            case 'cube':
                // 魔方：连锁波浪翻转——以拾取格为中心，半径 3.2 格内按距离递增延迟依次翻转
                // （与 demo「连锁波浪翻转」同口径：障碍格跳过，翻线击晕语义沿用）
                if (map && typeof map.flipWave === 'function') {
                    map.flipWave(this.gridX, this.gridY);
                }
                break;
            case 'snow':
                // 雪花：全体怪物冰冻 8s（铁锤 4s 的强化版）；重生闪烁预警中的怪物无敌豁免
                if (typeof enemies !== 'undefined') {
                    enemies.forEach(e => {
                        if (e && e.alive && (e.warning || 0) <= 0) {
                            e.stunned = Math.max(e.stunned, 8000);
                            console.log(`[Item] 雪花冰冻 ${e.name} 8s (${e.gridX},${e.gridY})`);
                        }
                    });
                }
                break;
        }
    }
}

// ============================================
// 翻转卡辅助：整行/整列翻转未翻转地板（带涟漪优先级）
// ============================================
// 规则：只翻未翻转的白格（已翻转的不需要翻转）；障碍（石头/箱子/墙）与黑洞格跳过；
// 优先级：delay 按白格到"最近已翻转格"的距离递增（靠近灰色区域的先翻，涟漪向外蔓延）；
//        本行/列没有已翻转格时，以玩家位置为涟漪起点；fromPlayer=true → 翻到怪击晕
function flipRowInstant(row, playerCol) {
    if (!map || row < 0 || row >= ROWS) return;
    const whites = [], grays = [];
    for (let c = 0; c < COLS; c++) {
        if (map.stoneGrid[row][c] || map.wallGrid[row][c] || map.hasBox(c, row)) continue;
        if (typeof isBlackHole === 'function' && isBlackHole(c, row)) continue;
        const tile = map.tiles[row][c];
        if (!tile) continue;
        if (tile.color === map.cellColor) whites.push(c);
        else grays.push(c);
    }
    whites.forEach(c => {
        const dist = grays.length
            ? Math.min(...grays.map(g => Math.abs(g - c)))     // 优先级：距最近已翻转格
            : Math.abs(c - (playerCol || 0));                  // 无灰格时以玩家为起点
        addPendingFlip(c, row, map.tiles[row][c].color, map.tiles[row][c].borderColor,
            map.flippedColor, map.flippedBorderColor, true, dist * RIPPLE_STEP, true);
    });
}
function flipColInstant(col, playerRow) {
    if (!map || col < 0 || col >= COLS) return;
    const whites = [], grays = [];
    for (let r = 0; r < ROWS; r++) {
        if (map.stoneGrid[r][col] || map.wallGrid[r][col] || map.hasBox(col, r)) continue;
        if (typeof isBlackHole === 'function' && isBlackHole(col, r)) continue;
        const tile = map.tiles[r][col];
        if (!tile) continue;
        if (tile.color === map.cellColor) whites.push(r);
        else grays.push(r);
    }
    whites.forEach(r => {
        const dist = grays.length
            ? Math.min(...grays.map(g => Math.abs(g - r)))
            : Math.abs(r - (playerRow || 0));
        addPendingFlip(col, r, map.tiles[r][col].color, map.tiles[r][col].borderColor,
            map.flippedColor, map.flippedBorderColor, true, dist * RIPPLE_STEP, true);
    });
}

// ============================================
// 道具生成（箱子消失时调用）
// force=true 时强制掉落（角落），否则 70% 概率掉落
function spawnItem(col, row, force = false) {
    const roll = Math.random();
    if (!force && roll >= 0.7) {
        console.log(`[spawnItem] 没有道具掉落 (${(roll*100).toFixed(0)}%)`);
        return;
    }
    
    const itemRoll = Math.random();
    let type;
    
    // 累计概率区间（修复原区间重叠导致的爱心/炸弹永不掉落 BUG）：
    // 沙漏 20% | 铁锤 8% | 爱心 8% | 炸弹 14% | 其余 50% 水果
    if (itemRoll < 0.20) {
        type = 'time';
    } else if (itemRoll < 0.28) {
        type = 'hammer';
    } else if (itemRoll < 0.36) {
        type = 'heart';
    } else if (itemRoll < 0.50) {
        type = 'boom';
    } else {
        type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    }
    
    console.log(`[spawnItem] ${force ? '[角落强制]' : '[随机]'} 生成: ${ITEM_TYPES[type].name} (${col},${row})`);
    items.push(new Item(type, col, row));
}

// 检查指定位置是否有道具，有则拾取
function pickupItem(col, row) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].gridX === col && items[i].gridY === row) {
            const info = ITEM_TYPES[items[i].type];
            if (info.category === 'hammer') {
                console.log(`[pickupItem] → 拾取: ${info.name} 击晕全部怪物`);
            } else if (info.category === 'boom') {
                console.log(`[pickupItem] → 拾取: ${info.name} 击杀全部怪物`);
            } else if (info.category === 'heart') {
                console.log(`[pickupItem] → 拾取: ${info.name} +1生命`);
            } else if (info.category === 'time') {
                console.log(`[pickupItem] → 拾取: ${info.name} +10秒`);
            } else {
                console.log(`[pickupItem] → 拾取: ${info.name} +${info.score}分`);
            }
            items[i].onPickup();
            // 电玩特效：拾取飘字 + 闪光爆裂
            if (typeof spawnFloatText === 'function') {
                const fxMap = { fruit: '+' + info.score, time: '+10s', heart: '+1UP', hammer: 'STUN!',
                                boom: 'BOOM!', flip: 'FLIP!', snow: 'FREEZE!', wave: 'WAVE!' };
                const fxC = { fruit: '#ffd700', time: '#00e5ff', heart: '#ff6b9d', hammer: '#ff8c00',
                              boom: '#ff4444', flip: '#00e5ff', snow: '#00e5ff', wave: '#ffd700' };
                spawnFloatText(col, row, fxMap[info.category] || info.name, fxC[info.category] || '#ffd700');
            }
            if (typeof spawnBurst === 'function') spawnBurst(col, row, ['#ffd700', '#ffffff', '#ff8c00'], 12);
            items.splice(i, 1);
            return true;
        }
    }
    return false;
}
