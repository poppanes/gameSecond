// ============================================
// 游戏配置
// ============================================
const ROWS = 7;           // 7行
const COLS = 8;           // 8列
const CELL_SIZE = 88;     // 每格大小（含边框）
const BORDER_WIDTH = 6;   // 边框宽度
const CELL_CONTENT = CELL_SIZE - BORDER_WIDTH * 2;

// 画布配置
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 900;

// 格子区域
const GRID_WIDTH = COLS * CELL_SIZE;
const GRID_HEIGHT = ROWS * CELL_SIZE;

// 居中偏移
const OFFSET_X = (CANVAS_WIDTH - GRID_WIDTH) / 2;
const OFFSET_Y = (CANVAS_HEIGHT - GRID_HEIGHT) / 2;

// ============================================
// 游戏状态
// ============================================
let canvas = null;
let ctx = null;
let player = null;
let gameInput = null;
let map = null;

// 游戏总时长（毫秒）
const GAME_DURATION = 150 * 1000;

// 奖励关卡配置
const BONUS_FLASH_DURATION = 5000;      // 闪烁阶段 5秒
const BONUS_PLAY_DURATION = 30000;      // 翻牌阶段 30秒
const BONUS_SETTLE_DURATION = 10000;    // 结算阶段 10秒
const BONUS_FRUIT_COUNT = 12;           // 水果数量
const BONUS_BOMB_COUNT = 20;            // 炸弹数量
const BONUS_FLASH_INTERVAL = 250;       // 闪烁间隔 ms

// 奖励关卡水果类型（与道具水果对应）
const BONUS_FRUIT_TYPES = {
    cherry:     { name: '樱桃',     score: 100,  src: '../fn-image/item/cherry.png' },
    apple:      { name: '苹果',     score: 200,  src: '../fn-image/item/apple.png' },
    peach:      { name: '桃子',     score: 400,  src: '../fn-image/item/peach.png' },
    watermelon: { name: '西瓜',     score: 800,  src: '../fn-image/item/watermelon.png' },
    icecream:   { name: '雪糕',     score: 5000, src: '../fn-image/item/icecream.png' },
};

// ============================================
// 游戏类
// ============================================
class Game {
    constructor() {
        this.canvas = document.getElementById('canvas1');
        ctx = this.canvas.getContext('2d');
        this.ctx = ctx;
        
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
        
        // 剩余时间（ms）
        this.timeLeft = GAME_DURATION;
        this.gameOver = false;
        this.gameWin = false;
        this.score = 0;
        
        // 奖励关卡状态
        this.bonusMode = false;
        this.bonusPhase = 'flashing';    // 'flashing' | 'playing' | 'settlement'
        this.bonusPhaseTimer = 0;
        this.bonusFruits = [];           // [{col, row, type, flipped}]
        this.bonusBombs = new Set();     // "col,row"
        this.bonusCollected = {};        // {cherry:0, apple:0, ...}
        this.bonusFlashTick = 0;
        this.bonusFlashOn = true;
        this._bonusImages = {};          // 预加载水果/炸弹图片缓存
        this._bonusEndTimer = null;       // 奖励关卡结束延迟器
        this._bonusWinTimer = 0;           // 通关后→奖励关卡延迟(ms)
    }
    
    init() {
        // 先重置游戏状态（阻止 loop 中误判）
        this.gameOver = false;
        this.gameWin = false;
        this.timeLeft = GAME_DURATION;
        this.score = 0;
        
        // 清空残留的延迟翻转和动画
        clearAllFlips();
        // 清空旧道具
        items.length = 0;
        
        // 初始化地图
        map = new Map(this.ctx);
        
        // 初始化玩家（位置：第4列第3行）
        player = new Player(3, 2);
        
        // 初始化/更新输入控制器（复用，不重复绑定事件）
        if (!gameInput) {
            gameInput = new GameInput(player);
        } else {
            gameInput.updatePlayer(player);
        }
        
        // 生成敌人
        enemies.length = 0;
        respawnQueue.length = 0;
        blackHoles.length = 0;  // 清空黑洞
        // 初始生成怪物（最多 MAX_ENEMIES 只）
        for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();
    }
    
    start() {
        this.init();
        requestAnimationFrame((t) => this.loop(t));
    }
    
    loop(timestamp) {
        const dt = getDeltaTime(timestamp);
        this.update(dt);
        this.render();
        requestAnimationFrame((t) => this.loop(t));
    }
    
    update(dt) {
        // 防御 NaN：异常 dt 视为 0
        if (!isFinite(dt)) dt = 0;
        
        // 奖励关卡模式
        if (this.bonusMode) {
            this._updateBonus(dt);
            return;
        }
        
        if (!this.gameOver && !this.gameWin) {
            // 倒计时
            if (this.timeLeft > 0) {
                this.timeLeft = Math.max(0, this.timeLeft - dt);
                if (this.timeLeft <= 0) {
                    this.gameOver = true;
                    gameInput.enabled = false;
                }
            }
            // 更新延迟翻转队列
            updatePendingFlips(dt);
            // 更新翻转动画
            updateAnimations(dt);
            // 更新所有敌人
            enemies.forEach(e => e.update(dt));
            // 清理已死亡敌人 → 加入复活队列
            for (let i = enemies.length - 1; i >= 0; i--) {
                if (!enemies[i].alive) killEnemy(enemies[i]);
            }
            // 更新玩家平滑移动
            if (player) player.update(dt);
            // 玩家碰撞敌人检测（硬直中/拾取中/预警中不触发）
            if (player && !player.isDead()) {
                for (const e of enemies) {
                    if (e && e.alive && e.warning <= 0 && e.stunned <= 0 && !e.carried && !e.flying &&
                        e.gridX === player.gridX && e.gridY === player.gridY) {
                        if (player.invTimer <= 0) e._hitPlayer();
                        break;
                    }
                }
            }
            // 处理复活队列
            processRespawn(dt);
            // 通关检测：只要所有地板已变灰色即通关 → 显示胜利画面 → 进入奖励关卡
            if (map && map.areAllFlipped() && this._bonusWinTimer === 0) {
                clearAllFlips();
                gameInput.enabled = false;
                this._bonusWinTimer = 3000;  // 3秒后进奖励关卡
                console.log('[Game] 通关！3秒后进入奖励关卡');
            }
        }
        
        // 通关胜利画面停留计时
        if (this._bonusWinTimer > 0) {
            this._bonusWinTimer -= dt;
            this.gameWin = true;  // 显示 CLEAR 画面
            if (this._bonusWinTimer <= 0) {
                this._bonusWinTimer = 0;
                this.gameWin = false;
                this._startBonusRound();
            }
            return;
        }
    }
    
    render() {
        // 清空画布
        this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // 绘制地图
        if (map) {
            map.draw();
        }
        
        // 奖励关卡模式
        if (this.bonusMode) {
            this._renderBonus();
            return;
        }
        
        // 绘制翻转动画（覆盖在格子上层）
        drawFlipAnimations();
        
        // 绘制道具
        items.forEach(item => item.draw(this.ctx));
        
        // 绘制黑洞（黑色格子）
        if (typeof blackHoles !== 'undefined') {
            blackHoles.forEach(bh => {
                const bx = OFFSET_X + bh.col * CELL_SIZE;
                const by = OFFSET_Y + bh.row * CELL_SIZE;
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(bx, by, CELL_SIZE, CELL_SIZE);
                this.ctx.strokeStyle = '#222';
                this.ctx.lineWidth = BORDER_WIDTH;
                this.ctx.strokeRect(bx, by, CELL_SIZE, CELL_SIZE);
            });
        }
        
        // 绘制所有敌人
        enemies.forEach(e => e.draw(this.ctx));
        
        // 绘制玩家
        if (player) {
            player.draw(this.ctx);
        }
        
        // 绘制倒计时
        this.drawTimer();
        // 绘制生命值
        this.drawLives();
        // 绘制分数
        this.drawScore();
        
        // 通关画面
        if (this.gameWin) {
            this.drawGameWin();
        }
        // 游戏结束画面
        if (this.gameOver) {
            this.drawGameOver();
        }
    }
    
    // 奖励关卡渲染
    _renderBonus() {
        // 玩家仅 playing 阶段可见
        if (player && this.bonusPhase === 'playing') {
            player.draw(this.ctx);
        }
        
        if (this.bonusPhase === 'flashing') {
            this._drawFlashingNotice();
        }
        
        if (this.bonusPhase === 'playing') {
            // 炸弹：仅翻出后才显示图标
            this.bonusBombs.forEach(key => {
                const [c, r] = key.split(',').map(Number);
                const t = map.tiles[r][c];
                if (t.flipped && t.color === '#e94560') {
                    const img = this._bonusImages['boom'];
                    if (img && img.complete) {
                        const x = OFFSET_X + c * CELL_SIZE + BORDER_WIDTH;
                        const y = OFFSET_Y + r * CELL_SIZE + BORDER_WIDTH;
                        const sz = CELL_SIZE - BORDER_WIDTH * 2;
                        this.ctx.drawImage(img, x, y, sz, sz);
                    }
                }
            });
            // 水果：翻出后图标常驻（白底+水果图标）
            this.bonusFruits.forEach(f => {
                if (f.flipped) {
                    const img = this._bonusImages[f.type];
                    if (img && img.complete) {
                        const x = OFFSET_X + f.col * CELL_SIZE + BORDER_WIDTH;
                        const y = OFFSET_Y + f.row * CELL_SIZE + BORDER_WIDTH;
                        const sz = CELL_SIZE - BORDER_WIDTH * 2;
                        this.ctx.drawImage(img, x, y, sz, sz);
                    }
                }
            });
            this.drawTimer();
        }
        
        if (this.bonusPhase === 'settlement') {
            this._drawSettlement();
        }
    }
    
    // 通关画面
    drawGameWin() {
        const ctx = this.ctx;
        ctx.save();
        
        // 半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // 通关标题
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText('CLEAR!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        ctx.fillText('CLEAR!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        
        // 提示
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeText('All Tiles Flipped!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.fillText('All Tiles Flipped!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        
        // 重新开始提示（闪烁效果）
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.font = '22px Arial';
        ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        ctx.fillText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        
        ctx.restore();
    }
    
    // 游戏结束覆盖层
    drawGameOver() {
        const ctx = this.ctx;
        
        // 半透明遮罩
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // Game Over 标题
        ctx.font = 'bold 72px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e94560';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        
        // Time's Up 提示
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeText('Time\'s Up!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.fillText('Time\'s Up!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        
        // 重新开始提示（闪烁效果）
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.font = '22px Arial';
        ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        ctx.fillText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        
        ctx.restore();
    }
    
    // 左上角生命值（P-2 形式）
    drawLives() {
        if (!player) return;
        const ctx = this.ctx;
        const text = `P - ${player.lives}`;
        
        ctx.save();
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        // 生命值耗尽时变红
        ctx.fillStyle = player.lives <= 0 ? '#ff4444' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 5;
        
        // 与倒计时保持同一水平线
        const x = OFFSET_X;
        const y = OFFSET_Y / 2;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.restore();
    }
    
    // 顶部居中倒计时（Time：XXs）
    drawTimer() {
        const seconds = Math.ceil(this.timeLeft / 1000);
        const text = `Time：${seconds}s`;
        
        const ctx = this.ctx;
        ctx.save();
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 时间紧迫时变红
        ctx.fillStyle = seconds <= 10 ? '#ff4444' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 5;
        
        const x = CANVAS_WIDTH / 2;
        const y = OFFSET_Y / 2;   // 地图上方居中
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.restore();
    }
    
    // 增加分数
    addScore(amount) {
        this.score += amount;
    }
    
    // 右上角分数显示
    drawScore() {
        const ctx = this.ctx;
        const text = `Score: ${this.score}`;
        
        ctx.save();
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 5;
        
        const x = OFFSET_X + GRID_WIDTH;
        const y = OFFSET_Y / 2;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.restore();
    }
    
    // ============================================
    // 奖励关卡系统
    // ============================================
    
    // 生成奖励关卡布局（12水果 + 20炸弹）
    _genBonusLayout() {
        const all = [];
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                all.push([c, r]);
        // 洗牌
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }
        
        this.bonusFruits = [];
        // 1个雪糕（固定）
        const ic = all.pop();
        this.bonusFruits.push({ col: ic[0], row: ic[1], type: 'icecream', flipped: false });
        // 11个水果：樱桃40%，其余各20%
        const types = [];
        for (let i = 0; i < 11; i++) {
            const r = Math.random();
            if (r < 0.40) types.push('cherry');
            else if (r < 0.53) types.push('apple');
            else if (r < 0.67) types.push('peach');
            else types.push('watermelon');
        }
        for (let i = 0; i < 11; i++) {
            const p = all.pop();
            this.bonusFruits.push({ col: p[0], row: p[1], type: types[i], flipped: false });
        }
        // 20个炸弹
        this.bonusBombs = new Set();
        for (let i = 0; i < BONUS_BOMB_COUNT; i++) {
            const p = all.pop();
            this.bonusBombs.add(`${p[0]},${p[1]}`);
        }
    }
    
    // 进入奖励关卡
    _startBonusRound() {
        console.log('[Bonus] 进入奖励关卡');
        this.bonusMode = true;
        this.bonusPhase = 'flashing';
        this.bonusPhaseTimer = BONUS_FLASH_DURATION;
        this.bonusFlashTick = 0;
        this.bonusFlashOn = true;
        this.bonusCollected = { cherry: 0, apple: 0, peach: 0, watermelon: 0, icecream: 0 };
        
        // 清除旧地图状态
        enemies.length = 0;
        respawnQueue.length = 0;
        blackHoles.length = 0;
        items.length = 0;
        clearAllFlips();
        
        // 空地图（无障碍）
        map = new Map(this.ctx);
        map.initEmpty();
        
        // 闪烁期间不创建玩家
        player = null;
        gameInput.enabled = false;
        
        this._genBonusLayout();
        this._preloadBonusImages();
        console.log(`[Bonus] 12 水果 + ${BONUS_BOMB_COUNT} 炸弹 已生成`);
    }
    
    _preloadBonusImages() {
        for (const [key, info] of Object.entries(BONUS_FRUIT_TYPES)) {
            if (!this._bonusImages[key]) {
                const img = new Image();
                img.src = info.src;
                this._bonusImages[key] = img;
            }
        }
        if (!this._bonusImages['boom']) {
            const img = new Image();
            img.src = '../fn-image/boom.png';
            this._bonusImages['boom'] = img;
        }
    }
    
    // 奖励关卡每帧更新
    _updateBonus(dt) {
        this.bonusPhaseTimer -= dt;
        
        switch (this.bonusPhase) {
            case 'flashing':
                // 闪烁12个水果格
                this.bonusFlashTick += dt;
                if (this.bonusFlashTick >= BONUS_FLASH_INTERVAL) {
                    this.bonusFlashTick -= BONUS_FLASH_INTERVAL;
                    this.bonusFlashOn = !this.bonusFlashOn;
                    const tileColor = this.bonusFlashOn ? map.flippedColor : map.cellColor;
                    const borderColor = this.bonusFlashOn ? map.flippedBorderColor : map.borderColor;
                    this.bonusFruits.forEach(f => {
                        if (!f.flipped) {
                            const t = map.tiles[f.row][f.col];
                            t.color = tileColor;
                            t.borderColor = borderColor;
                        }
                    });
                }
                if (this.bonusPhaseTimer <= 0) {
                    // 进入玩牌阶段：生成玩家、恢复格子白色
                    this.bonusPhase = 'playing';
                    this.bonusPhaseTimer = BONUS_PLAY_DURATION;
                    this.timeLeft = BONUS_PLAY_DURATION;
                    // 创建玩家（闪烁结束后才出现）
                    player = new Player(3, 2);
                    if (gameInput) gameInput.updatePlayer(player);
                    gameInput.enabled = true;
                    // 水果格恢复白色
                    this.bonusFruits.forEach(f => {
                        if (!f.flipped) {
                            const t = map.tiles[f.row][f.col];
                            t.color = map.cellColor;
                            t.borderColor = map.borderColor;
                        }
                    });
                    console.log('[Bonus] 开始翻牌');
                }
                break;
                
            case 'playing':
                this.timeLeft = Math.max(0, this.timeLeft - dt);
                // 更新玩家
                if (player) player.update(dt);
                if (this.bonusPhaseTimer <= 0 || this.timeLeft <= 0) {
                    this._endBonusRound(false);
                }
                break;
                
            case 'settlement':
                if (this.bonusPhaseTimer <= 0) {
                    // 结算结束 → 进入正常回合
                    this._endBonusRound(false);
                }
                break;
        }
    }
    
    // 奖励关卡翻牌处理
    onBonusFlip(col, row) {
        if (this.bonusPhase !== 'playing') return;
        const key = `${col},${row}`;
        
        // 炸弹 → 立刻结束
        if (this.bonusBombs.has(key)) {
            const t = map.tiles[row][col];
            t.flipped = true;
            t.color = '#e94560';
            t.borderColor = '#8b0000';
            console.log(`[Bonus] 💣 翻到炸弹 (${col},${row}) → 结束`);
            this._endBonusRound(true);
            return;
        }
        
        // 水果 → 收集
        const fruit = this.bonusFruits.find(f => f.col === col && f.row === row && !f.flipped);
        if (fruit) {
            fruit.flipped = true;
            const info = BONUS_FRUIT_TYPES[fruit.type];
            this.score += info.score;
            this.bonusCollected[fruit.type] = (this.bonusCollected[fruit.type] || 0) + 1;
            // 背景保持白色 + 水果图标常驻，不翻成灰色
            const t = map.tiles[row][col];
            t.flipped = true;
            console.log(`[Bonus] 🍎 翻到 ${info.name} +${info.score} (${col},${row})`);
            
            // 所有水果翻完 → 进入结算
            if (this.bonusFruits.every(f => f.flipped)) {
                this._endBonusRound(false);
            }
            return;
        }
        // 普通格子：翻成灰色
        const t = map.tiles[row][col];
        if (!t.flipped) {
            t.flipped = true;
            t.color = map.flippedColor;
            t.borderColor = map.flippedBorderColor;
        }
    }
    
    // 结束奖励关卡
    _endBonusRound(fromBomb) {
        this.bonusPhase = 'settlement';
        this.bonusPhaseTimer = BONUS_SETTLE_DURATION;
        gameInput.enabled = false;
        console.log(`[Bonus] 进入结算 (炸弹:${fromBomb})`);
        
        // 预加载图片
        this._preloadBonusImages();
        
        // 10秒后退出
        if (this._bonusEndTimer) clearTimeout(this._bonusEndTimer);
        this._bonusEndTimer = setTimeout(() => {
            if (!this.bonusMode) return;
            this.bonusMode = false;
            this.bonusBombs = new Set();
            this.bonusFruits = [];
            this._bonusEndTimer = null;
            console.log('[Bonus] 结算结束 → 进入正常回合');
            this.init();
        }, BONUS_SETTLE_DURATION);
    }
    
    // 绘制结算面板
    _drawSettlement() {
        const ctx = this.ctx;
        ctx.save();
        
        // 半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // 标题
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText('BONUS ROUND CLEAR!', CANVAS_WIDTH / 2, 100);
        ctx.fillText('BONUS ROUND CLEAR!', CANVAS_WIDTH / 2, 100);
        
        // 水果收集列表
        const fruitKeys = ['cherry', 'apple', 'peach', 'watermelon', 'icecream'];
        let totalBonus = 0;
        let y = 180;
        
        fruitKeys.forEach(key => {
            const count = this.bonusCollected[key] || 0;
            if (count === 0) return;
            const info = BONUS_FRUIT_TYPES[key];
            const subTotal = info.score * count;
            totalBonus += subTotal;
            
            // 图标
            const img = this._bonusImages[key];
            if (img && img.complete) ctx.drawImage(img, CANVAS_WIDTH / 2 - 200, y - 18, 36, 36);
            
            // 数量×分数
            ctx.font = 'bold 28px Arial';
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 3;
            ctx.textAlign = 'left';
            ctx.strokeText(`${info.name}  ×${count}  +${subTotal}`, CANVAS_WIDTH / 2 - 150, y);
            ctx.fillText(`${info.name}  ×${count}  +${subTotal}`, CANVAS_WIDTH / 2 - 150, y);
            y += 50;
        });
        
        // 总分
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(`TOTAL: +${totalBonus}`, CANVAS_WIDTH / 2, y + 30);
        ctx.fillText(`TOTAL: +${totalBonus}`, CANVAS_WIDTH / 2, y + 30);
        
        // 倒计时
        const remain = Math.ceil(this.bonusPhaseTimer / 1000);
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = '#aaa';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        const tAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.fillStyle = `rgba(255,255,255,${tAlpha})`;
        ctx.strokeText(`Next round in ${remain}s...`, CANVAS_WIDTH / 2, y + 80);
        ctx.fillText(`Next round in ${remain}s...`, CANVAS_WIDTH / 2, y + 80);
        
        ctx.restore();
    }
    
    // 绘制闪烁阶段提示
    _drawFlashingNotice() {
        const ctx = this.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 36px Arial';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText('BONUS ROUND!', CANVAS_WIDTH / 2, 80);
        ctx.fillText('BONUS ROUND!', CANVAS_WIDTH / 2, 80);
        ctx.font = '20px Arial';
        ctx.fillStyle = '#fff';
        ctx.strokeText('Match the hidden fruits!', CANVAS_WIDTH / 2, 115);
        ctx.fillText('Match the hidden fruits!', CANVAS_WIDTH / 2, 115);
        ctx.restore();
    }

    // 重新开始游戏
    restart(reason = '未知') {
        // 守卫：只有真正结束（时间到/通关/死亡）才允许重开，防止误触空格
        if (!this.gameOver && !this.gameWin && !this.bonusMode) {
            console.log(`[Game] 游戏进行中，忽略重启指令 (来源: ${reason})`);
            return;
        }
        console.log(`[Game] 重启游戏 | 原因: ${reason} | gameOver=${this.gameOver} | gameWin=${this.gameWin}`);
        this.bonusMode = false;
        this.bonusBombs = new Set();
        this.bonusFruits = [];
        this._bonusWinTimer = 0;
        if (this._bonusEndTimer) { clearTimeout(this._bonusEndTimer); this._bonusEndTimer = null; }
        this.init();
    }
}

// ============================================
// 启动游戏
// ============================================
let game;  // 全局引用，供 input.js 重启用
window.addEventListener('load', function() {
    console.log('[Game] 页面加载完成 → 首次启动');
    game = new Game();
    game.start();
});
