// ============================================
// 游戏配置
// ============================================
const ROWS = 7;           // 7行
const COLS = 8;           // 8列
// 电玩像素字体（crt.js 会预热加载；离线/未加载完自动降级等宽字体）
const ARCADE_FONT = '"Press Start 2P", "Courier New", monospace';
const MENU_PER_PAGE = 16;             // 菜单分页：每页卡片数（4 列 × 4 行）

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
const BONUS_BOMB_COUNT = 12;            // 炸弹数量（2026-10-20 由 20 下调：密度 35.7%→21.4%，与水果对等）
const BONUS_FLASH_INTERVAL = 250;       // 闪烁间隔 ms

// 是否显示帧率（调试用，上线可改 false）
const SHOW_FPS = true;

// 测试地图工具名（显示用；与 ITEM_TYPES 定版对齐，避免出现 undefined）
const TEST_TOOL_NAMES = {
    Ghost: '幽灵', Spider: '蜘蛛', Snowman: '雪人', Octopus: '章鱼', Owl: '猫头鹰',
    stone: '石头', box: '箱子', wall: '墙', hole: '黑洞',
    clearObj: '清除物件', clearEnemy: '清除怪物',
    banana: '香蕉', orange: '橙子', dragonfruit: '火龙果', watermelon: '西瓜', icecream: '雪糕饮料',
    time: '沙漏', hammer: '铁锤', heart: '爱心', boom: '炸弹',
    flip1: '翻转卡·青', flip2: '翻转卡·粉', cube: '魔方', snowflake: '雪花',
};

// 测试地图道具循环顺序（[I] 键循环切换）
const TEST_ITEM_TYPES = ['banana', 'orange', 'dragonfruit', 'watermelon', 'icecream', 'time', 'hammer', 'heart', 'boom', 'flip1', 'flip2', 'cube', 'snowflake'];

// 奖励关卡水果类型（与道具系统水果统一，素材均在 fn-image/item/，已剔除 cherry/apple/peach）
// weight = 随机生成权重；雪糕为固定 1 个（weight:0 不参与随机抽取）
// 分值沿用原梯度：100 / 200 / 400 / 800 / 5000
const BONUS_FRUIT_TYPES = {
    banana:     { name: '香蕉',   score: 100,  weight: 40, src: '../fn-image/item/banana.png' },
    orange:     { name: '橙子',   score: 200,  weight: 20, src: '../fn-image/item/orange.png' },
    dragonfruit:{ name: '火龙果', score: 400,  weight: 20, src: '../fn-image/item/dragonfruit.png' },
    watermelon: { name: '西瓜',   score: 800,  weight: 20, src: '../fn-image/item/watermelon.png' },
    icecream:   { name: '雪糕',   score: 5000, weight: 0,  src: '../fn-image/item/icecream.png' },
};

// ============================================
// 游戏类
// ============================================
class Game {
    constructor() {
        this.canvas = document.getElementById('canvas1');

        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;

        // CRT 电玩渲染层：ctx 重定向到 1/3 低分辨率缓冲（?crt=0 关闭；逻辑零改动）
        ctx = (window.CRT ? CRT.wrap(this.canvas) : this.canvas.getContext('2d'));
        this.ctx = ctx;
        
        // 剩余时间（ms）
        this.timeLeft = GAME_DURATION;
        this.gameOver = false;
        this.gameWin = false;
        this.score = 0;
        this._hiScore = parseInt((typeof localStorage !== 'undefined' && localStorage.getItem('fn_hi')) || '0', 10) || 0;   // 街机 HI-SCORE（持久化）
        
        // 关卡进度状态
        this.mode = 'menu';               // 'menu' | 'playing'
        this.levelIndex = 0;              // 当前关卡在 LEVELS 中的索引
        this.unlockedIndex = UNLOCK_ALL ? LEVELS.length - 1 : loadProgress();  // 已解锁最大索引（UNLOCK_ALL 测试开关可全解锁）
        this.menuCursor = 0;              // 菜单光标位置
        this._levelClearTimer = 0;        // 通关停留计时(ms)
        this.testMode = false;            // 测试地图模式（沙盒：自由生成怪物/物件）
        this._testMapVisible = SHOW_TEST_MAP;   // 菜单测试地图卡片显隐（` 键可临时切换）
        this._menuPage = 0;                   // 菜单分页（0 起；光标跨页自动翻页）
        this.fps = 0;                     // 当前帧率（SHOW_FPS 控制是否绘制）
        this._fpsFrames = 0;              // FPS 采样帧数
        this._fpsTimer = 0;               // FPS 采样累计时间(ms)
        this._testTool = null;            // 当前选中的测试工具（怪物类型 / 物件类型）
        this._testCanvasBound = false;    // canvas 鼠标点击事件是否已绑定
        this._toolToast = null;           // 工具切换弹窗反馈（画布中央大字，1.4s 淡出）
        this._portalPlacing = null;       // 传送门放置状态（null=无；{col,row,enter}=入口已放待出口）
        
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
    }
    
    start() {
        this.mode = 'menu';
        // 菜单阶段也需要键盘监听（用于选择关卡）
        if (!gameInput) {
            gameInput = new GameInput(null);
        }
        requestAnimationFrame((t) => this.loop(t));
    }
    
    // 加载指定关卡（索引），自动区分正常关卡 / 特殊关卡（奖励关卡）
    loadLevel(index) {
        if (index >= LEVELS.length) {
            // 全部通关 → 回到菜单
            this._backToMenu();
            return;
        }
        this.levelIndex = index;
        this.mode = 'playing';
        this.testMode = false;   // 确保离开测试地图
        const config = getLevelConfig(index);
        this._resetRoundState();
        
        if (config.type === 'bonus') {
            this._startBonusRound();
        } else if (config.type === 'boss') {
            this._startBossRound();
        } else {
            this._startNormalRound(config);
        }
    }
    
    // 重置单局运行时状态（分数跨关累计，此处不清零）
    _resetRoundState() {
        this.gameOver = false;
        this.gameWin = false;
        this.timeLeft = GAME_DURATION;
        this._roundScoreBase = this.score;    // 本关得分基准（广告双倍用）
        this._adDoubleUsed = false;           // 本关双倍奖励是否已领
        if (typeof AdManager !== 'undefined') AdManager.hideBanner();   // 进游戏收起菜单横幅
        this._levelClearTimer = 0;
        this.bonusMode = false;
        this.bossMode = false;
        this.bonusFruits = [];
        this.bonusBombs = new Set();
        if (this._bonusEndTimer) { clearTimeout(this._bonusEndTimer); this._bonusEndTimer = null; }
        
        // 清空残留的延迟翻转和动画
        clearAllFlips();
        // 清空旧道具
        items.length = 0;
        // 清空敌人 / 复活队列 / 黑洞
        enemies.length = 0;
        respawnQueue.length = 0;
        blackHoles.length = 0;
    }
    
    // 开始一个正常关卡
    _startNormalRound(config) {
        this.timeLeft = getLevelTime(config);
        
        // 初始化地图
        map = new Map(this.ctx);
        
        // 应用关卡预设布局（石头/箱子），无布局则使用随机摆放
        const layout = parseLevelLayout(config);
        if (layout) {
            map.applyLayout(layout);
        }
        map.setPortals(config.portals);            // 传送门门对（关卡可选配置；15 回合内不配置）
        
        // 初始化玩家（位置：第4列第4行）
        player = new Player(3, 3);
        
        // 初始化/更新输入控制器（复用，不重复绑定事件）
        if (!gameInput) {
            gameInput = new GameInput(player);
        } else {
            gameInput.updatePlayer(player);
        }
        gameInput.enabled = true;
        
        // 按关卡配置生成指定怪物
        this._spawnEnemiesForLevel(config);
        console.log(`[Level] 进入 ${config.name} (tier${config.tier}, ${this.timeLeft / 1000}s)`);
    }
    
    // 按关卡配置生成指定类型/数量的怪物，并设置复活上限
    _spawnEnemiesForLevel(config) {
        const list = config.enemies || {};
        const spawners = {
            Ghost: () => spawnGhost(),
            Spider: () => spawnSpider(),
            Snowman: () => spawnSnowman(),
            Octopus: () => spawnOctopus(),
            Owl: () => spawnOwl(),
        };
        let total = 0;
        for (const [type, count] of Object.entries(list)) {
            if (!spawners[type]) { console.warn(`[Level] 未知怪物类型: ${type}`); continue; }
            for (let i = 0; i < count; i++) { spawners[type](); total++; }
        }
        MAX_ENEMIES = Math.max(1, total);  // 复活上限 = 本关初始怪物数
        console.log(`[Level] 生成怪物 ${total} 只: ${JSON.stringify(list)}`);
    }
    
    // ============================================
    // 测试地图（沙盒模式）
    // ============================================
    _startTestMap() {
        this.testMode = true;
        this.levelIndex = -1;          // 不占正常关卡索引
        this.mode = 'playing';
        this._testTool = null;         // 进入沙盒时清空工具
        this._portalPlacing = null;    // 清空传送门放置状态
        this._resetRoundState();
        this._bindTestCanvas();        // 绑定鼠标点击（防重复）
        
        // 空地图（无障碍）：skipDecor 跳过构造器默认的随机石头/箱子
        map = new Map(this.ctx, { skipDecor: true });
        map.initEmpty();
        
        // 玩家出生
        player = new Player(3, 3);
        if (!gameInput) {
            gameInput = new GameInput(player);
        } else {
            gameInput.updatePlayer(player);
        }
        gameInput.enabled = true;
        
        // 测试地图：怪物复活上限放宽
        MAX_ENEMIES = 99;
        
        console.log('[Test] 进入测试地图：先按键选工具，再鼠标点击格子放置/清除；Esc返回菜单');
    }
    
    // 绑定 canvas 鼠标点击事件（仅一次）
    _bindTestCanvas() {
        if (this._testCanvasBound) return;
        this._testCanvasBound = true;
        this.canvas.addEventListener('click', (e) => this._onTestCanvasClick(e));
        this.canvas.addEventListener('mousemove', (e) => this._onTestCanvasMove(e));
    }

    // 鼠标移动 → 悬停格跟踪（测试地图坐标显示）
    _onTestCanvasMove(e) {
        if (!this.testMode) { this._hoverCell = null; return; }
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / rect.width;
        const scaleY = CANVAS_HEIGHT / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        const col = Math.floor((mx - OFFSET_X) / CELL_SIZE);
        const row = Math.floor((my - OFFSET_Y) / CELL_SIZE);
        this._hoverCell = (col >= 0 && col < COLS && row >= 0 && row < ROWS) ? { col, row } : null;
    }
    
    // 鼠标点击 → 网格坐标 → 应用当前工具
    _onTestCanvasClick(e) {
        if (!this.testMode) return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / rect.width;
        const scaleY = CANVAS_HEIGHT / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        const col = Math.floor((mx - OFFSET_X) / CELL_SIZE);
        const row = Math.floor((my - OFFSET_Y) / CELL_SIZE);
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
        this._applyTestTool(col, row);
    }
    
    // 在指定格应用当前选中的工具
    _applyTestTool(col, row) {
        const tool = this._testTool;
        if (!tool) {
            console.log('[test] 未选择工具：先按 1-6(怪物/BOSS)/Q/E/R/T(物件)/C(清物件)/G(清怪) 再点击');
            return;
        }
        const key = `${col},${row}`;
        
        switch (tool) {
            case 'Ghost': case 'Spider': case 'Snowman': case 'Octopus': case 'Owl':
                spawnEnemyAt(tool, col, row);
                break;
            case 'stone':
                map.stoneGrid[row][col] = true;
                console.log(`[test] 放置石头 (${col},${row})`);
                break;
            case 'box':
                map.boxGrid[row][col] = true;
                map.boxNeverPushed.add(key);
                console.log(`[test] 放置箱子 (${col},${row})`);
                break;
            case 'wall':
                map.wallGrid[row][col] = true;
                console.log(`[test] 放置墙 (${col},${row})`);
                break;
            case 'hole':
                blackHoles.push({ col, row, owner: null });
                console.log(`[test] 放置黑洞 (${col},${row})`);
                break;
            case 'clearObj':
                map.stoneGrid[row][col] = false;
                map.boxGrid[row][col] = false;
                map.boxNeverPushed.delete(key);
                map.wallGrid[row][col] = false;
                blackHoles = blackHoles.filter(bh => !(bh.col === col && bh.row === row));
                console.log(`[test] 清除物件 (${col},${row})`);
                break;
            case 'clearEnemy': {
                // 命中判定：怪物显示区域与点击格重叠（兼容滑动中逻辑格已提前跳到目标格、
                // 视觉卡在两格之间的怪物——旧逻辑按 gridX/Y 精确匹配会点不中）
                const px = OFFSET_X + col * CELL_SIZE;
                const py = OFFSET_Y + row * CELL_SIZE;
                let removed = 0;
                for (let i = enemies.length - 1; i >= 0; i--) {
                    const en = enemies[i];
                    if (!en || !en.alive) continue;
                    const size = en.size || (CELL_SIZE - BORDER_WIDTH * 2);
                    const hit = en.pixelX < px + CELL_SIZE && en.pixelX + size > px &&
                                en.pixelY < py + CELL_SIZE && en.pixelY + size > py;
                    if (hit) {
                        console.log(`[test] 移除怪物 ${en.name} (逻辑格 ${en.gridX},${en.gridY})`);
                        en.alive = false;
                        en._killed = true;
                        enemies.splice(i, 1);
                        removed++;
                    }
                }
                if (removed === 0) console.log(`[test] 清除怪物：(${col},${row}) 处没有怪物`);
                break;
            }
            // 道具：直接放置指定类型
            case 'banana': case 'orange': case 'dragonfruit': case 'watermelon': case 'icecream':
            case 'time': case 'hammer': case 'heart': case 'boom': case 'flip1': case 'flip2': case 'cube': case 'snowflake':
                items.push(new Item(tool, col, row));
                console.log(`[test] 放置道具 ${ITEM_TYPES[tool].name} (${col},${row})`);
                break;
        }
    }
    
    // 测试地图按键：选择工具（再用鼠标点击放置）
    testKeyDown(code) {
        switch (code) {
            case 'Digit1': this._testTool = 'Ghost';   break;
            case 'Digit2': this._testTool = 'Spider';  break;
            case 'Digit3': this._testTool = 'Snowman'; break;
            case 'Digit4': this._testTool = 'Octopus'; break;
            case 'Digit5': this._testTool = 'Owl';     break;
            case 'Digit7': {
                if (player) { player.godMode = !player.godMode; console.log('[test] 无敌模式：' + (player.godMode ? '开启（一切伤害免疫）' : '关闭')); }
                break;
            }
            case 'Digit6': {
                if (typeof bossKing !== 'undefined' && bossKing) { bossKing = null; console.log('[test] BOSS 幽灵王已移除'); }
                else { bossKing = new BossKing(); console.log('[test] BOSS 幽灵王已召唤（血量 100，飞行中）'); }
                break;
            }
            case 'KeyQ': this._testTool = 'stone';     break;
            case 'KeyE': this._testTool = 'box';       break;
            case 'KeyR': this._testTool = 'wall';      break;
            case 'KeyT': this._testTool = 'hole';      break;
            case 'KeyC': {
                // 一键清除全部物件：石头/箱子/墙/黑洞 + 全部传送门
                if (map) {
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) {
                            map.stoneGrid[r][c] = false;
                            map.boxGrid[r][c] = false;
                            map.wallGrid[r][c] = false;
                        }
                    }
                    map.boxNeverPushed.clear();
                    // 黑洞：先恢复被 Owl 染黑的地板原色，再清空黑洞列表
                    if (typeof blackHoles !== 'undefined') {
                        blackHoles.forEach(bh => {
                            if (bh && bh.prevColor && map.tiles[bh.row] && map.tiles[bh.row][bh.col]) {
                                const t = map.tiles[bh.row][bh.col];
                                t.color = bh.prevColor;
                                if (bh.prevBorder) t.borderColor = bh.prevBorder;
                            }
                        });
                        blackHoles.length = 0;
                    }
                    // 传送门全部清空 + 放置状态重置
                    map.setPortals([]);
                    this._portalPlacing = null;
                    if (typeof bossKing !== 'undefined') bossKing = null;   // BOSS 一并清除
                }
                console.log('[test] 一键清除全部物件（石头/箱子/墙/黑洞/传送门）');
                break;
            }
            case 'KeyF': {
                // 一键全场怪物硬直（测试用：方便验证硬直相关逻辑/摆拍）；重生闪烁预警中的怪物无敌豁免
                let n = 0;
                enemies.forEach(e => {
                    if (e && e.alive && (e.warning || 0) <= 0) { e.stunned = ENEMY_STUN_DURATION; n++; }
                });
                console.log(`[test] 一键全场怪物硬直 ×${n}`);
                break;
            }
            case 'KeyG': {
                // 一键清除全部怪物（不进复活队列，清了就没了）
                let n = 0;
                for (let i = enemies.length - 1; i >= 0; i--) {
                    const en = enemies[i];
                    if (!en) continue;
                    en.alive = false;
                    en._killed = true;
                    enemies.splice(i, 1);
                    n++;
                }
                if (typeof bossKing !== 'undefined') bossKing = null;   // BOSS 一并清除
        console.log(`[test] 一键清除全部怪物 ×${n}`);
                break;
            }
            case 'KeyI': this._cycleTestItem();        break;
            case 'KeyP': {
                // 传送门放置循环：入口 → 出口（配对生效）→ 入口 → 出口……多对共存；取消用 C 键
                if (!player || !map) break;
                const pc = player.gridX, pr = player.gridY;
                const edge = map._portalEdge({ col: pc, row: pr });
                if (!edge) { console.log('[test] 站到边缘格子（左右列/上下行）再按 P 放置传送门'); break; }
                if (this._portalPlacing) {
                    // 放出口：与待配对入口组成门对（第 N 对生效），下一轮继续放新入口
                    const pair = map._normalizePair({
                        a: { col: this._portalPlacing.col, row: this._portalPlacing.row, enter: this._portalPlacing.enter },
                        b: { col: pc, row: pr }
                    });
                    if (pair) { pair[0].peer = pair[1]; pair[1].peer = pair[0]; map.portals.push(...pair); }
                    console.log(`[test] 出口已放置 (${pc},${pr}) → 第${Math.floor(map.portals.length / 2)}对传送门生效（C键清除全部）`);
                    this._portalPlacing = null;
                } else {
                    // 放入口（当前边缘格，触发方向 = 该边缘朝外）
                    const enter = edge === 'left' ? [-1, 0] : edge === 'right' ? [1, 0]
                        : edge === 'top' ? [0, -1] : [0, 1];
                    this._portalPlacing = { col: pc, row: pr, enter };
                    console.log(`[test] 入口已放置 (${pc},${pr})——走到目标边缘再按 P 放置出口`);
                }
                break;
            }
            case 'Escape': case 'Backspace':
                this._backToMenu();
                break;
        }
        if (this._testTool) {
            console.log(`[test] 当前工具: ${TEST_TOOL_NAMES[this._testTool] || this._testTool}（鼠标点击格子放置）`);
            this._showToolToast(this._testTool);   // 画布中央弹窗反馈（可视确认当前工具）
        }
    }

    // 工具切换弹窗反馈：画布中央大字，出现时放大 + 尾部 400ms 淡出
    _showToolToast(tool) {
        const name = TEST_TOOL_NAMES[tool] || tool || '';
        this._toolToast = { text: name, t: 1400, total: 1400 };
    }

    // 弹窗绘制（测试地图最上层；工具名中文用 Arial，金色光晕）
    _drawToolToast() {
        if (!this._toolToast) return;
        const ctx = this.ctx;
        const { text, t, total } = this._toolToast;
        const appear = 1 - t / total;                        // 0→1 出现进度
        const alpha = Math.min(1, t / 400);                  // 尾部淡出
        const scale = 1 + Math.max(0, 0.35 - appear) * 1.6;  // 出现瞬间放大回落
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 16;
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.fillText(text, 0, 0);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = '#ffd700';
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }
    
    // 循环切换道具类型（[I] 键）
    _cycleTestItem() {
        const idx = TEST_ITEM_TYPES.indexOf(this._testTool);
        const next = (idx + 1) % TEST_ITEM_TYPES.length;
        this._testTool = TEST_ITEM_TYPES[next];
        console.log(`[test] 切换到道具: ${TEST_TOOL_NAMES[this._testTool] || this._testTool}`);
    }
    
    loop(timestamp) {
        const dt = getDeltaTime(timestamp);
        
        // FPS 统计（每 500ms 刷新一次）
        this._fpsFrames++;
        this._fpsTimer += dt;
        if (this._fpsTimer >= 500) {
            this.fps = Math.round(this._fpsFrames * 1000 / this._fpsTimer);
            this._fpsFrames = 0;
            this._fpsTimer = 0;
        }
        
        this.update(dt);
        
        // 每帧驱动持续移动：本帧走完一格后，立即续下一格（不再等 keydown repeat）
        if (gameInput && this.mode === 'playing') gameInput.update();
        
        this.render();
        if (window.CRT) CRT.present();   // CRT 层上屏：NEAREST 放大 + 扫描线
        requestAnimationFrame((t) => this.loop(t));
    }
    
    update(dt) {
        // 防御 NaN：异常 dt 视为 0
        if (!isFinite(dt)) dt = 0;
        
        // 菜单模式：不更新游戏逻辑
        if (this.mode === 'menu') return;
        
        // 奖励关卡模式
        if (this.bonusMode) {
            this._updateBonus(dt);
            return;
        }

        // BOSS 关卡模式
        if (this.bossMode) {
            this._updateBossRound(dt);
            return;
        }
        
        // 工具切换弹窗衰减
        if (this._toolToast) {
            this._toolToast.t -= dt;
            if (this._toolToast.t <= 0) this._toolToast = null;
        }

        if (!this.gameOver && !this.gameWin) {
            // 倒计时（测试地图不限时）
            if (this.timeLeft > 0 && !this.testMode) {
                this.timeLeft = Math.max(0, this.timeLeft - dt);
                if (this.timeLeft <= 0) {
                    this.gameOver = true;
        if (typeof Sfx !== 'undefined') Sfx.play('gameover');   // [C] 失败音效
                    gameInput.enabled = false;
                }
            }
            // 更新延迟翻转队列
            updatePendingFlips(dt);
            // 更新翻转动画
            updateAnimations(dt);
            // 电玩特效层推进（浮动文字 / 爆裂粒子）
            if (typeof updateFloatTexts === 'function') updateFloatTexts();
            if (typeof updateBursts === 'function') updateBursts(dt);
            // 更新所有敌人
            enemies.forEach(e => e.update(dt));
        if (typeof bossKing !== 'undefined' && bossKing) bossKing.update(dt);   // [Boss] BOSS 更新（测试地图召唤）
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
            // 通关检测：所有地板已变灰 → 显示胜利画面 → 解锁并进入下一关（测试地图不判通关）
            if (!this.testMode && map && map.areAllFlipped() && this._levelClearTimer === 0) {
                clearAllFlips();
                gameInput.enabled = false;
                this._lastRoundScore = this.score - this._roundScoreBase;   // 本关得分（广告双倍用）
                if (typeof Sfx !== 'undefined') Sfx.play('clear');   // [C] 通关音效
                this._levelClearTimer = 3000;  // 3秒后进入下一关
                this._unlockNext();            // 通关 → 解锁下一关
                console.log('[Game] 通关！3秒后进入下一关');
            }
        }
        
        // 通关胜利画面停留计时
        if (this._levelClearTimer > 0) {
            this._levelClearTimer -= dt;
            this.gameWin = true;  // 显示 CLEAR 画面
            if (this._levelClearTimer <= 0) {
                this._levelClearTimer = 0;
                this.gameWin = false;
                this._advanceToNextLevel();
            }
            return;
        }
    }
    
    // 解锁下一关（持久化到 localStorage）
    _unlockNext() {
        const next = Math.min(this.levelIndex + 1, LEVELS.length - 1);
        if (next > this.unlockedIndex) {
            this.unlockedIndex = next;
            saveProgress(next);
            const name = LEVELS[next] ? LEVELS[next].name : '全部通关';
            console.log(`[Level] 解锁: ${name} (索引${next})`);
        }
    }
    
    // 进入下一关（levelIndex + 1）
    _advanceToNextLevel() {
        if (typeof AdManager !== 'undefined') AdManager.showInterstitial('level_gap');   // 关卡间隙插屏（门面层自带频控）
        let next = this.levelIndex + 1;
        if (!SHOW_SPECIAL_LEVELS) {
            while (next < LEVELS.length && LEVELS[next].type === 'bonus') next++;   // 特殊关卡隐藏 → 跳过
        }
        this.loadLevel(next);
    }

    // ============================================
    // 广告位业务接入（AdManager 门面；开发模式 Mock 立即回调，可直接游玩测试）
    // ============================================
    // 看广告复活（GAME OVER 画面按 R）：恢复 1 命继续本关
    requestAdRevive() {
        if (!this.gameOver || this.testMode) return;
        if (typeof AdManager === 'undefined') return;
        if (!AdManager.isReady('rewarded')) { console.log('[Ad] 复活广告未就绪'); return; }
        AdManager.showRewarded('revive',
            () => this._applyAdRevive(),
            (ok) => { if (!ok) console.log('[Ad] 复活广告未完成，不复活'); });
    }

    _applyAdRevive() {
        if (!player) return;
        this.gameOver = false;
        player.lives = 1;                     // 恢复 1 命
        player._revive();                     // 解锁移动 + 重生点落位 + 无敌帧（复用受伤重生链）
        gameInput.enabled = true;
        if (this.timeLeft <= 0) this.timeLeft = 30000;   // 时间到死亡的复活缓冲
        if (typeof spawnFloatText === 'function') {
            spawnFloatText(player.gridX, player.gridY, 'REVIVE!', '#ffd700');
        }
        console.log('[Ad] 看广告复活：恢复 1 命继续本关');
    }

    // 看广告双倍奖励（CLEAR 画面按 D）：再得一次本关得分，每关限一次
    requestAdDoubleScore() {
        if (!this.gameWin || this._adDoubleUsed) return;
        if (typeof AdManager === 'undefined' || !(this._lastRoundScore > 0)) return;
        if (!AdManager.isReady('rewarded')) { console.log('[Ad] 双倍广告未就绪'); return; }
        AdManager.showRewarded('double_score',
            () => {
                this._adDoubleUsed = true;
                this.addScore(this._lastRoundScore);   // 复用加分（自动更新 HI-SCORE）
                console.log(`[Ad] 双倍奖励：+${this._lastRoundScore}`);
            },
            (ok) => { if (!ok) console.log('[Ad] 双倍广告未完成'); });
    }
    
    // 全部通关 → 回到菜单
    _backToMenu() {
        this.mode = 'menu';
        this.gameOver = false;
        this.gameWin = false;
        this.bonusMode = false;
        this.testMode = false;
        clearAllFlips();
        items.length = 0;
        enemies.length = 0;
        respawnQueue.length = 0;
        blackHoles.length = 0;
        if (typeof AdManager !== 'undefined') AdManager.showBanner('menu_banner');   // 回菜单展示横幅
        console.log('[Game] 返回菜单');
    }
    
    render() {
        // 清空画布
        this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 覆盖层动画起点检测（CLEAR / GAME OVER 首帧记录，非覆盖态自动复位）
        if (this.gameWin || this.gameOver) {
            if (!this._overlayAnimStart) this._overlayAnimStart = performance.now();
        } else {
            this._overlayAnimStart = 0;
        }
        
        // 帧率显示（最上层，所有模式都画）
        if (SHOW_FPS) this.drawFps();
        
        // 菜单模式：绘制关卡选择菜单
        if (this.mode === 'menu') {
            this._renderMenu();
            return;
        }
        
        // 绘制地图（箱子拆出分层：伪 3D 深度排序，修复"箱子在玩家下方时透视玩家"的 BUG）
        const pBottom = player ? (player.pixelY + player.height) : 0;   // 玩家 sprite 底部 y = 深度分割线
        if (map) {
            map.draw(false);                    // 地板+石头+墙（不含箱子）
            map.drawStampLayer();   // 猪头印平滑层：地板之上、实体之下（与 demo 两段渲染同口径）
            map.drawBoxesSplit(pBottom, false); // 箱子远景层：格底在玩家之上（被玩家遮挡）
            map.drawPortals(performance.now());        // 传送门（地图外门区：能量底光+光点+chevron）
        }
        
        // 奖励关卡模式
        if (this.bonusMode) {
            this._renderBonus();
            return;
        }

        // BOSS 关卡模式
        if (this.bossMode) {
            this._renderBossRound();
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
        if (typeof bossKing !== 'undefined' && bossKing) { bossKing.draw(this.ctx); bossKing.drawHpBar(this.ctx); }   // [Boss] BOSS 绘制+血量条
        
        // 绘制玩家
        if (player) {
            player.draw(this.ctx);
        }

        // 箱子近景层：格底在玩家之下（伪 3D 中离镜头更近，遮挡玩家/怪物下半身）
        if (map) {
            map.drawBoxesSplit(pBottom, true);
        }

        // 电玩特效层（最上层：爆裂粒子 + 浮动文字）
        if (typeof drawBursts === 'function') drawBursts(this.ctx);
        if (typeof drawFloatTexts === 'function') drawFloatTexts(this.ctx);
        
        // 街机 HUD 信息栏（生命 ♥ / TIME / SCORE；测试地图中部留给测试标签）
        this.drawHud(this.testMode);
        if (this.testMode) {
            this.drawTestLabel();     // 测试模式 + 当前工具 + 玩家 POS
            this._drawTestHover();    // 悬停格高亮 + 坐标标签
            this.drawTestHelp();      // 含待配对入口标记（传送门三态放置可视化）
            this._drawToolToast();    // 工具切换弹窗（最上层）
        }
        
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
        if (this.bonusPhase === 'flashing') {
            this._drawFlashingNotice();
        }

        if (this.bonusPhase === 'playing') {
            // 炸弹：仅翻出后才显示图标（物件层，先画）
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
            // 水果：翻出后图标常驻（白底+水果图标；物件层，先画）
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
            // 角色最后绘制（层级高于水果/炸弹物件，走格子时不会被物件盖住）
            drawFlipAnimations();          // 翻板动画（物件之上、角色之下；原奖励关路径缺失导致动画不可见）
            if (player) {
                player.draw(this.ctx);
            }
            this.drawTimer();
        }

        if (this.bonusPhase === 'settlement') {
            this._drawSettlement();
        }
    }
    
    // 通关画面
    // 覆盖层砸落动画缓动：0 → 1（easeOutCubic）
    _overlayEase() {
        const elapsed = this._overlayAnimStart ? (performance.now() - this._overlayAnimStart) : 999;
        const t = Math.min(1, elapsed / 450);
        return 1 - Math.pow(1 - t, 3);
    }

    drawGameWin() {
        const ctx = this.ctx;
        ctx.save();

        // 半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 通关标题：砸落动画 + 霓虹光晕高亮 + 呼吸脉动（醒目大字）
        const ease = this._overlayEase();
        const settle = 1 + (1 - ease) * 1.6;
        const pulse = ease >= 1 ? 1 + Math.sin(performance.now() / 220) * 0.035 : settle;   // 落定后呼吸脉动
        const glow = 16 + Math.sin(performance.now() / 220) * 8;                            // 光晕随呼吸强弱
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        ctx.scale(pulse, pulse);
        ctx.globalAlpha = ease;
        ctx.font = `36px ${ARCADE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 光晕层（金色霓虹，双层叠加更醒目）
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = glow;
        ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
        ctx.fillText('STAGE CLEAR!', 0, 0);
        ctx.shadowBlur = glow + 14;
        ctx.fillText('STAGE CLEAR!', 0, 0);
        // 实体字层（黑描边 + 金色实心）
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
        ctx.strokeText('STAGE CLEAR!', 0, 0);
        ctx.fillStyle = '#ffd700';
        ctx.fillText('STAGE CLEAR!', 0, 0);
        ctx.restore();

        // 提示（标题落定后渐显）
        ctx.font = `14px ${ARCADE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = ease > 0.6 ? (ease - 0.6) / 0.4 : 0;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeText('All Tiles Flipped!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.fillText('All Tiles Flipped!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.globalAlpha = 1;

        // 下一关提示（闪烁效果）
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.font = '22px Arial';
        ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('进入下一关...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        ctx.fillText('进入下一关...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);

        // 看广告双倍奖励提示（激励视频，金色闪烁）
        ctx.font = '18px Arial';
        ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('D: 看广告双倍奖励', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 105);
        ctx.fillText('D: 看广告双倍奖励', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 105);

        ctx.restore();
    }
    
    // 游戏结束覆盖层
    drawGameOver() {
        const ctx = this.ctx;

        // 半透明遮罩
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Game Over 标题：砸落动画（震感更强：落下 + 微弹）
        const ease = this._overlayEase();
        const dropY = (1 - ease) * -140;
        const scale = 1 + (1 - ease) * 1.8;
        const shakeX = ease >= 1 ? Math.sin(performance.now() / 40) * 2 : 0;   // 落定后微颤
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2 + shakeX, CANVAS_HEIGHT / 2 - 40);
        ctx.scale(scale, scale);
        ctx.globalAlpha = ease;
        ctx.font = `36px ${ARCADE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e94560';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
        ctx.strokeText('GAME OVER', 0, 0);
        ctx.fillText('GAME OVER', 0, 0);
        ctx.restore();

        // Time's Up 提示（标题落定后渐显）
        ctx.font = `14px ${ARCADE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = ease > 0.6 ? (ease - 0.6) / 0.4 : 0;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeText('Time\'s Up!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.fillText('Time\'s Up!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
        ctx.globalAlpha = 1;

        // 重试提示（闪烁效果）
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.font = '22px Arial';
        ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('空格键重试本关', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
        ctx.fillText('空格键重试本关', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);

        // 看广告复活提示（激励视频，金色闪烁）
        ctx.font = '18px Arial';
        ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.strokeText('R: 看广告复活', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 105);
        ctx.fillText('R: 看广告复活', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 105);

        ctx.restore();
    }
    
    // 左上角生命值（P-2 形式）
    drawLives() {
        if (!player) return;
        const ctx = this.ctx;
        const text = `P-${player.lives}`;
        
        ctx.save();
        ctx.font = `20px ${ARCADE_FONT}`;
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
    
    // 街机 HUD 信息栏：左生命 ♥ / 中 TIME（测试地图让位给测试标签）/ 右 SCORE
    drawHud(testMode = false) {
        const ctx = this.ctx;
        ctx.save();

        // 顶部信息栏（地图上方区域：半透明黑 + 霓虹底边）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, OFFSET_Y - 8);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, OFFSET_Y - 8);
        ctx.lineTo(CANVAS_WIDTH, OFFSET_Y - 8);
        ctx.stroke();

        ctx.textBaseline = 'middle';
        const y = (OFFSET_Y - 8) / 2;

        // 左：生命 ♥（≤1 时红色告警）
        if (player) {
            const hearts = '♥'.repeat(Math.max(0, player.lives));
            ctx.font = '20px Arial';
            ctx.textAlign = 'left';
            ctx.fillStyle = player.lives <= 1 ? '#ff4444' : '#ff6b9d';
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 4;
            ctx.strokeText(hearts, OFFSET_X, y);
            ctx.fillText(hearts, OFFSET_X, y);
        }

        // 中：TIME（testMode 时中部留给测试标签）
        if (!testMode) {
            const seconds = Math.ceil(this.timeLeft / 1000);
            ctx.font = `18px ${ARCADE_FONT}`;
            ctx.textAlign = 'center';
            ctx.fillStyle = seconds <= 10 ? '#ff4444' : '#ffffff';
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 5;
            ctx.strokeText('TIME ' + seconds, CANVAS_WIDTH / 2, y);
            ctx.fillText('TIME ' + seconds, CANVAS_WIDTH / 2, y);
        }

        // 右：SCORE（金色，右对齐到地图右缘）
        ctx.font = `16px ${ARCADE_FONT}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 5;
        ctx.strokeText('' + this.score, OFFSET_X + GRID_WIDTH, y);
        ctx.fillText('' + this.score, OFFSET_X + GRID_WIDTH, y);

        ctx.restore();
    }

    // 顶部居中倒计时（Time：XXs）
    drawTimer() {
        const seconds = Math.ceil(this.timeLeft / 1000);
        const text = `TIME ${seconds}`;
        
        const ctx = this.ctx;
        ctx.save();
        ctx.font = `20px ${ARCADE_FONT}`;
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
    
    // 测试地图标签（替代倒计时）
    drawTestLabel() {
        const ctx = this.ctx;
        ctx.save();
        ctx.font = 'bold 34px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#c9a6ff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 5;
        const x = CANVAS_WIDTH / 2;
        const y = OFFSET_Y / 2;
        ctx.strokeText('测试模式', x, y);
        ctx.fillText('测试模式', x, y);
        
        // 当前工具提示（命名表兜底：未知工具显示键名，避免 undefined）
        const toolName = this._testTool ? (TEST_TOOL_NAMES[this._testTool] || this._testTool) : '未选择工具';
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = this._testTool ? '#ffd700' : '#999';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText('工具: ' + toolName + '（点击格子放置）', x, y + 38);
        ctx.fillText('工具: ' + toolName + '（点击格子放置）', x, y + 38);

        // 玩家坐标 + 无敌状态（测试对照）
        if (player) {
            if (player.godMode) {
                ctx.font = 'bold 18px Arial';
                ctx.fillStyle = '#ffd700';
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 3;
                ctx.strokeText('GOD MODE', x, y + 98);
                ctx.fillText('GOD MODE', x, y + 98);
            }
            ctx.font = 'bold 18px Arial';
            ctx.fillStyle = '#7fd7ff';
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 3;
            const posLabel = `POS: ${player.gridX},${player.gridY}`;
            ctx.strokeText(posLabel, x, y + 68);
            ctx.fillText(posLabel, x, y + 68);
        }
        ctx.restore();
    }

    // 悬停格高亮 + 坐标标签（测试地图鼠标位置可视化）
    _drawTestHover() {
        if (!this._hoverCell) return;
        const ctx = this.ctx;
        const { col, row } = this._hoverCell;
        const x = OFFSET_X + col * CELL_SIZE;
        const y = OFFSET_Y + row * CELL_SIZE;
        ctx.save();
        ctx.strokeStyle = 'rgba(0,229,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const label = `${col},${row}`;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, x + 4, y + 16);
        ctx.fillStyle = 'rgba(0,229,255,0.95)';
        ctx.fillText(label, x + 4, y + 16);
        ctx.restore();
    }
    
    // 测试地图底部按键说明
    drawTestHelp() {
        const ctx = this.ctx;
        const mapBottom = OFFSET_Y + GRID_HEIGHT;  // 地图下边缘
        const cx = CANVAS_WIDTH / 2;
        
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '16px Arial';
        ctx.lineWidth = 3;
        
        // 第一行：怪物
        let y = mapBottom + 22;
        ctx.fillStyle = '#9fb3d9';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const line1 = '怪物: [1]幽灵  [2]蜘蛛  [3]雪人  [4]章鱼  [5]猫头鹰  [6]BOSS幽灵王';
        ctx.strokeText(line1, cx, y);
        ctx.fillText(line1, cx, y);
        
        // 第二行：物件
        y += 26;
        ctx.fillStyle = '#a5d9a5';
        const line2 = '物件: [Q]石头 [E]箱子 [R]墙 [T]黑洞 [C]清物件 [G]清怪 [F]全硬直';
        ctx.strokeText(line2, cx, y);
        ctx.fillText(line2, cx, y);
        
        // 第三行：道具
        y += 26;
        ctx.fillStyle = '#f0a0c0';
        const line3 = '道具: [I]切换(香蕉/橙子/火龙果/西瓜/雪糕/沙漏/铁锤/爱心/炸弹/翻转卡·青/翻转卡·粉/魔方/雪花)';
        ctx.strokeText(line3, cx, y);
        ctx.fillText(line3, cx, y);
        
        // 第四行：其他
        y += 26;
        ctx.fillStyle = '#d9b98a';
        const line4 = '[Esc/Backspace]返回菜单  [空格]重开沙盒  [方向键/WASD]移动  [P]传送门(入口→出口→取消)';
        ctx.strokeText(line4, cx, y);
        ctx.fillText(line4, cx, y);

        // 传送门待配对入口标记：金色闪烁圈 + "入口"提示（三态放置的中间态可视化）
        if (this._portalPlacing) {
            const plx = OFFSET_X + this._portalPlacing.col * CELL_SIZE + CELL_SIZE / 2;
            const ply = OFFSET_Y + this._portalPlacing.row * CELL_SIZE + CELL_SIZE / 2;
            const plPulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
            ctx.save();
            ctx.globalAlpha = 0.5 + plPulse * 0.4;
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(plx, ply, 14 + plPulse * 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = '#ffd700';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('入口', plx, ply - 26);
            ctx.restore();
        }

        ctx.restore();
    }
    
    // 绘制帧率（左上角）
    drawFps() {
        const ctx = this.ctx;
        ctx.save();
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        // 颜色按帧率档位区分：>=55 绿 / >=30 黄 / 否则红
        ctx.fillStyle = this.fps >= 55 ? '#4ade80' : (this.fps >= 30 ? '#facc15' : '#f87171');
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3;
        const text = `${this.fps} FPS`;
        ctx.strokeText(text, 10, 10);
        ctx.fillText(text, 10, 10);
        ctx.restore();
    }
    
    // 增加分数
    addScore(amount) {
        this.score += amount;
        if (this.score > this._hiScore) {
            this._hiScore = this.score;
            try { localStorage.setItem('fn_hi', String(this._hiScore)); } catch (err) { /* 隐私模式等忽略 */ }
        }
    }
    
    // 右上角分数显示
    drawScore() {
        const ctx = this.ctx;
        const text = `${this.score}`;
        
        ctx.save();
        ctx.font = `18px ${ARCADE_FONT}`;
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
        // 11个随机水果：按 BONUS_FRUIT_TYPES 的 weight 权重抽样（单一数据源，增删水果只改表）
        const types = [];
        const pool = Object.entries(BONUS_FRUIT_TYPES).filter(([, v]) => v.weight > 0);
        const weightSum = pool.reduce((s, [, v]) => s + v.weight, 0);
        for (let i = 0; i < 11; i++) {
            let r = Math.random() * weightSum;
            for (const [type, v] of pool) {
                r -= v.weight;
                if (r < 0) { types.push(type); break; }
            }
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
        // [LOG] 布局清单（排查翻牌/结算问题：对照玩家翻的格子与实际身份）
        console.log(`[Bonus][LOG] 布局生成: 水果 ${this.bonusFruits.map(f => `${BONUS_FRUIT_TYPES[f.type].name}@(${f.col},${f.row})`).join(' ')}`);
        console.log(`[Bonus][LOG] 布局生成: 炸弹 ${[...this.bonusBombs].join(' ')}`);
    }
    
    // 进入奖励关卡
    // ============================================
    // BOSS 关卡（全部关卡通关后进入；500 秒内击败幽灵王）
    // ============================================
    _startBossRound() {
        this.bossMode = true;
        map = new Map(this.ctx, { skipDecor: true });
        map.initEmpty();
        enemies.length = 0; blackHoles.length = 0;
        if (typeof items !== 'undefined') items.length = 0;
        player = new Player(3, 3);
        gameInput.updatePlayer(player);
        gameInput.enabled = true;
        this.timeLeft = BOSS_CONFIG.roundTime;   // 500 秒
        bossKing = new BossKing();
        console.log('[Boss] BOSS 战开始：击败幽灵王（血量 100，限时 500 秒）');
    }

    _updateBossRound(dt) {
        updateAnimations(dt);
        updatePendingFlips(dt);
        this.timeLeft -= dt;
        if (this.timeLeft <= 0 && !this.gameOver) {
            // 超时 → 失败（v1：走 game over 面板，Space 重开本关；B4 做专属结算）
            this.gameOver = true;
            gameInput.enabled = false;
            return;
        }
        if (bossKing) {
            bossKing.update(dt);
            if (bossKing.hp <= 0 && bossKing.state !== 'dying') {
                bossKing.state = 'dying';   // 死亡演出（B4 细化）
                console.log('[Boss] 幽灵王被击败！');
            }
        }
        if (player) player.update(dt);
    }

    _renderBossRound() {
        if (map) map.draw(false);
        drawFlipAnimations();
        if (player) player.draw(this.ctx);
        if (bossKing) { bossKing.draw(this.ctx); bossKing.drawHpBar(this.ctx); }
        this.drawTimer();
        this.drawHud(true);
    }

    _startBonusRound() {
        console.log('[Bonus] 进入奖励关卡');
        this.bonusMode = true;
        this.bonusPhase = 'flashing';
        this.bonusPhaseTimer = BONUS_FLASH_DURATION;
        this.bonusFlashTick = 0;
        this.bonusFlashOn = true;
        this.bonusCollected = {};
        Object.keys(BONUS_FRUIT_TYPES).forEach(k => { this.bonusCollected[k] = 0; });   // 从类型表动态初始化（防键位错位）
        this._bonusFlipCount = 0;   // [LOG] 翻牌次数统计
        
        // 清除旧地图状态
        enemies.length = 0;
        respawnQueue.length = 0;
        blackHoles.length = 0;
        items.length = 0;
        clearAllFlips();
        
        // 空地图（无障碍）：skipDecor 跳过构造器默认的随机石头/箱子
        map = new Map(this.ctx, { skipDecor: true });
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
        // 翻转/动画队列推进（onBonusFlip 的翻板动画依赖；原缺失导致动画卡首帧、回普通关后白板遮挡地板）
        updateAnimations(dt);
        updatePendingFlips(dt);

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
                    console.log('[Bonus][LOG] 翻牌阶段开始（限时30秒）：走格子按 J 翻脚下格');
                    this.bonusPhaseTimer = BONUS_PLAY_DURATION;
                    this.timeLeft = BONUS_PLAY_DURATION;
                    // 创建玩家（闪烁结束后才出现）
                    player = new Player(3, 3);
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
                    // 结算结束 → 直接进入正常回合（原重入 _endBonusRound 会造成二次结算跳转）
                    if (this._bonusEndTimer) { clearTimeout(this._bonusEndTimer); this._bonusEndTimer = null; }
                    this.bonusMode = false;
                    this.bonusBombs = new Set();
                    this.bonusFruits = [];
                    console.log('[Bonus][LOG] 结束: 结算到期 → 进入下一关');
                    this._advanceToNextLevel();
                }
                break;
        }
    }
    
    // 奖励关卡翻牌处理
    onBonusFlip(col, row) {
        if (this.bonusPhase !== 'playing') return;
        const key = `${col},${row}`;
        this._bonusFlipCount = (this._bonusFlipCount || 0) + 1;
        console.log(`[Bonus][LOG] 第${this._bonusFlipCount}次翻牌 (${col},${row}) 剩余${Math.ceil(this.timeLeft / 1000)}s 已翻水果${this.bonusFruits.filter(f => f.flipped).length}/12`);

        // 炸弹 → 立刻结束
        if (this.bonusBombs.has(key)) {
            const t = map.tiles[row][col];
            t.flipped = true;
            t.color = '#e94560';
            t.borderColor = '#8b0000';
            addFlipAnimation(col, row, map.cellColor, map.borderColor, '#e94560', '#8b0000');   // 翻转动画（与普通关一致）
            if (typeof Sfx !== 'undefined') Sfx.play('explode');   // [C] 爆炸音效
            if (typeof spawnFloatText === 'function') spawnFloatText(col, row, '炸弹!', '#ff4444');   // 即时反馈：浮动文字
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
            addFlipAnimation(col, row, map.cellColor, map.borderColor, map.cellColor, map.borderColor);   // 白→白翻板动作（图标其上常驻）
            if (typeof Sfx !== 'undefined') Sfx.play('pickup');   // [C] 水果收集音效
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
            addFlipAnimation(col, row, map.cellColor, map.borderColor, map.flippedColor, map.flippedBorderColor);   // 翻转动画（修复"按 J 像没反应"）
            if (typeof Sfx !== 'undefined') Sfx.play('flip');   // [C] 翻牌音效
            console.log(`[Bonus][LOG] (${col},${row}) 普通格 → 灰`);
        } else {
            console.log(`[Bonus][LOG] (${col},${row}) 已翻开，本次忽略`);
        }
    }
    
    // 结束奖励关卡
    _endBonusRound(fromBomb) {
        // 幂等保护：结算进行中禁止重入（防"二次结算跳转"——settlement 到期直接推进，不走这里）
        if (this.bonusPhase === 'settlement') return;
        // 记录结束原因（结算面板区分文案）：炸弹 / 全收集 / 超时
        this._bonusEndReason = fromBomb ? 'bomb'
            : (this.bonusFruits.every(f => f.flipped) ? 'clear' : 'timeout');
        this.bonusPhase = 'settlement';
        if (this._bonusEndReason === 'timeout' && typeof Sfx !== 'undefined') Sfx.play('timeout');   // [C] 超时音效
        this._settleAnimStart = performance.now();   // 结算滚动动画起点
        this.bonusPhaseTimer = BONUS_SETTLE_DURATION;
        gameInput.enabled = false;
        // [LOG] 结束汇总（原因/翻牌次数/收集明细/得分）
        const collectedStr = Object.entries(this.bonusCollected).filter(([, n]) => n > 0)
            .map(([k, n]) => `${BONUS_FRUIT_TYPES[k] ? BONUS_FRUIT_TYPES[k].name : k}×${n}`).join(' ') || '无';
        const totalGain = Object.entries(this.bonusCollected)
            .reduce((s, [k, n]) => s + (BONUS_FRUIT_TYPES[k] ? BONUS_FRUIT_TYPES[k].score * n : 0), 0);
        console.log(`[Bonus][LOG] 结束: 原因=${this._bonusEndReason} 翻牌${this._bonusFlipCount || 0}次 收集[${collectedStr}] 得分+${totalGain}`);
        console.log(`[Bonus] 进入结算 (炸弹:${fromBomb})`);

        // 预加载图片
        this._preloadBonusImages();

        // 推进时机统一由 _updateBonus 的 settlement 到期处理（原 setTimeout 与结算计时器双轨并行，
        // 会因 settlement 分支重入 _endBonusRound 造成"两次跳转结算页面"）
    }
    
    // 绘制结算面板
    _drawSettlement() {
        const ctx = this.ctx;
        ctx.save();

        // 半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 结算滚动进度：elapsed ∈ [0, ∞)，项依次渐现、总分滚动累加
        const elapsed = this._settleAnimStart ? (performance.now() - this._settleAnimStart) : 0;
        const ease = t => 1 - Math.pow(1 - Math.min(1, t), 3);   // easeOutCubic

        // 标题（按结束原因区分：全收集 CLEAR / 超时 TIME UP / 炸弹 BOOM）
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `24px ${ARCADE_FONT}`;
        let title = 'BONUS ROUND CLEAR!', titleColor = '#ffd700';
        if (this._bonusEndReason === 'timeout') { title = 'TIME UP!'; titleColor = '#ff8a5c'; }
        else if (this._bonusEndReason === 'bomb') { title = 'BOOM!'; titleColor = '#e94560'; }
        ctx.fillStyle = titleColor;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.strokeText(title, CANVAS_WIDTH / 2, 100);
        ctx.fillText(title, CANVAS_WIDTH / 2, 100);

        // 水果收集列表（按项渐现）——键位直接取自 BONUS_FRUIT_TYPES（单一数据源，杜绝错位）
        const fruitKeys = Object.keys(BONUS_FRUIT_TYPES);
        let totalBonus = 0;
        let y = 180;
        let idx = 0;

        fruitKeys.forEach(key => {
            const count = this.bonusCollected[key] || 0;
            if (count === 0) return;
            const info = BONUS_FRUIT_TYPES[key];
            const subTotal = info.score * count;
            totalBonus += subTotal;

            const showAt = 150 + idx * 220;              // 第 idx 项 220ms 后渐现
            const itemT = Math.max(0, Math.min(1, (elapsed - showAt) / 250));
            if (itemT > 0) {
                // 图标
                const img = this._bonusImages[key];
                if (img && img.complete) ctx.drawImage(img, CANVAS_WIDTH / 2 - 200, y - 18, 36, 36);

                // 数量×分数
                ctx.font = 'bold 28px Arial';
                ctx.globalAlpha = itemT;
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 3;
                ctx.textAlign = 'left';
                ctx.strokeText(`${info.name}  ×${count}  +${subTotal}`, CANVAS_WIDTH / 2 - 150, y);
                ctx.fillText(`${info.name}  ×${count}  +${subTotal}`, CANVAS_WIDTH / 2 - 150, y);
                ctx.globalAlpha = 1;
            }
            idx++;
            y += 50;
        });

        // 总分（滚动累加：随时间从 0 滚到 totalBonus）
        const rollT = ease(Math.max(0, (elapsed - 400) / 1000));
        const shownTotal = Math.floor(totalBonus * rollT);
        ctx.textAlign = 'center';
        ctx.font = `20px ${ARCADE_FONT}`;
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(`TOTAL: +${shownTotal}`, CANVAS_WIDTH / 2, y + 30);
        ctx.fillText(`TOTAL: +${shownTotal}`, CANVAS_WIDTH / 2, y + 30);

        // 倒计时（滚动结束后出现）
        if (elapsed > 1500) {
            const remain = Math.ceil(this.bonusPhaseTimer / 1000);
            ctx.font = 'bold 24px Arial';
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 2;
            const tAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
            ctx.fillStyle = `rgba(255,255,255,${tAlpha})`;
            ctx.strokeText(`Next round in ${remain}s...`, CANVAS_WIDTH / 2, y + 80);
            ctx.fillText(`Next round in ${remain}s...`, CANVAS_WIDTH / 2, y + 80);
        }

        ctx.restore();
    }
    
    // 绘制闪烁阶段提示
    _drawFlashingNotice() {
        const ctx = this.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `22px ${ARCADE_FONT}`;
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText('BONUS ROUND!', CANVAS_WIDTH / 2, 80);
        ctx.fillText('BONUS ROUND!', CANVAS_WIDTH / 2, 80);
        ctx.font = '20px Arial';
        ctx.fillStyle = '#fff';
        ctx.strokeText('Match the hidden fruits!', CANVAS_WIDTH / 2, 115);
        ctx.fillText('Match the hidden fruits!', CANVAS_WIDTH / 2, 115);
        ctx.restore();
    }

    // 重新开始（重试本关 / 快进下一关）
    restart(reason = '未知') {
        if (this.mode === 'menu') return;
        
        // 测试地图：空格重开沙盒
        if (this.testMode) {
            console.log(`[Game] 重开测试地图 (来源: ${reason})`);
            this._startTestMap();
            return;
        }
        
        // 奖励关卡结算阶段按空格 → 直接进入下一关
        if (this.bonusMode) {
            if (this.bonusPhase === 'settlement') {
                if (this._bonusEndTimer) { clearTimeout(this._bonusEndTimer); this._bonusEndTimer = null; }
                this.bonusMode = false;
                this.bonusBombs = new Set();
                this.bonusFruits = [];
                this._advanceToNextLevel();
            }
            return;
        }
        
        // 通关画面停留期间按空格 → 直接进入下一关
        if (this.gameWin) {
            console.log(`[Game] 通关快进下一关 (来源: ${reason})`);
            this._levelClearTimer = 0;
            this.gameWin = false;
            this._advanceToNextLevel();
            return;
        }
        
        // 游戏结束 → 无限重试本关
        console.log(`[Game] 重试本关 | 原因: ${reason} | levelIndex=${this.levelIndex}`);
        this.loadLevel(this.levelIndex);
    }
    
    // ============================================
    // 关卡选择菜单
    // ============================================
    _renderMenu() {
        const ctx = this.ctx;
        ctx.fillStyle = '#0b0b1e';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // 标题（街机 STAGE SELECT）
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `26px ${ARCADE_FONT}`;
        ctx.fillStyle = '#ffd700';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
        ctx.strokeText('STAGE SELECT', CANVAS_WIDTH / 2, 56);
        ctx.fillText('STAGE SELECT', CANVAS_WIDTH / 2, 56);
        ctx.font = 'bold 15px Arial';
        ctx.fillStyle = '#8ea6ff';
        ctx.fillText('· 关 卡 选 择 ·', CANVAS_WIDTH / 2, 94);
        // HI-SCORE（街机最高分，localStorage 持久化）
        ctx.font = `10px ${ARCADE_FONT}`;
        ctx.fillStyle = '#ffd700';
        ctx.fillText('HI-SCORE ' + this._hiScore, CANVAS_WIDTH / 2, 116);
        
        // 卡片网格：4 列 × 4 行/页（分页；总卡 = LEVELS + 测试地图，光标跨页自动翻页）
        const cols = 4;
        const cardW = 210;
        const cardH = 110;
        const gapX = 16;
        const gapY = 18;
        const startX = (CANVAS_WIDTH - (cols * cardW + (cols - 1) * gapX)) / 2;
        const startY = 130;
        
        // 分页渲染：4 列 × 4 行/页（关卡 + 测试地图统一遍历，隐藏卡片跳过）
        const total = LEVELS.length + 1;
        const pages = Math.ceil(total / MENU_PER_PAGE);
        this._menuPage = Math.min(this._menuPage, pages - 1);   // 页码越界保护
        const pageStart = this._menuPage * MENU_PER_PAGE;
        const pageEnd = Math.min(pageStart + MENU_PER_PAGE, total);
        for (let i = pageStart; i < pageEnd; i++) {
            if (!this._menuCardVisible(i)) continue;   // 隐藏卡片不渲染
            const idx = i - pageStart;                 // 页内序号（网格位置）
            const c = idx % cols;
            const r = Math.floor(idx / cols);
            const x = startX + c * (cardW + gapX);
            const y = startY + r * (cardH + gapY);
            const isTest = i === LEVELS.length;        // 测试地图卡片
            const unlocked = isTest ? true : i <= this.unlockedIndex;
            const selected = i === this.menuCursor;

            // 卡片背景（电玩配色：暗紫底 + 霓虹选中；测试地图紫色调）
            ctx.fillStyle = isTest ? (selected ? '#2c1f4d' : '#1c1530')
                : (unlocked ? (selected ? '#1e2c55' : '#141b36') : '#10101f');
            ctx.strokeStyle = isTest ? (selected ? '#ffd700' : '#4a3a6e')
                : (selected ? '#ffd700' : (unlocked ? '#2c3a68' : '#262640'));
            ctx.lineWidth = selected ? 4 : 2;
            ctx.fillRect(x, y, cardW, cardH);
            ctx.strokeRect(x, y, cardW, cardH);

            // 选中效果：跑马灯虚线外框 + ▶ 光标闪烁
            if (selected) {
                ctx.save();
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 2;
                ctx.setLineDash([12, 8]);
                ctx.lineDashOffset = -performance.now() / 30;   // 流动
                ctx.strokeRect(x - 5, y - 5, cardW + 10, cardH + 10);
                ctx.setLineDash([]);
                ctx.restore();
                if (Math.sin(performance.now() / 180) > -0.3) {
                    ctx.font = '16px Arial';
                    ctx.fillStyle = '#ffd700';
                    ctx.fillText('▶', x - 24, y + cardH / 2);
                }
            }

            if (isTest) {
                // 测试地图卡片：标题 + 沙盒说明（两行以卡片中心对称）
                ctx.font = 'bold 26px Arial';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText('测试地图', x + cardW / 2, y + cardH / 2 - 14);

                ctx.font = '15px Arial';
                ctx.fillStyle = '#c9a6ff';
                ctx.fillText('沙盒：自由生成', x + cardW / 2, y + cardH / 2 + 14);
            } else {
                const lvl = LEVELS[i];
                // 关卡名（像素字水平垂直居中；BONUS 关金色；未解锁上移给锁图标让位）
                ctx.font = `14px ${ARCADE_FONT}`;
                ctx.fillStyle = !unlocked ? '#555' : (lvl.type === 'boss' ? '#ff6b6b' : (lvl.type === 'bonus' ? '#ffd700' : '#fff'));
                ctx.textAlign = 'center';
                ctx.fillText(lvl.name, x + cardW / 2, unlocked ? y + cardH / 2 : y + cardH / 2 - 22);

                // 锁定标识：挂锁图标 + LOCKED（三行内容以卡片中心对称）
                if (!unlocked) {
                    this._drawLockIcon(ctx, x + cardW / 2, y + cardH / 2 + 2, 13);
                    ctx.font = `9px ${ARCADE_FONT}`;
                    ctx.fillStyle = '#666';
                    ctx.fillText('LOCKED', x + cardW / 2, y + cardH / 2 + 26);
                }
            }
        }
        
        // INSERT COIN（街机待机闪烁）+ 页码（多页时显示）
        if (Math.sin(performance.now() / 300) > -0.2) {
            ctx.font = `12px ${ARCADE_FONT}`;
            ctx.fillStyle = '#ffd700';
            ctx.fillText('INSERT COIN', CANVAS_WIDTH / 2 - 60, CANVAS_HEIGHT - 74);
        }
        if (pages > 1) {
            ctx.font = `10px ${ARCADE_FONT}`;
            ctx.fillStyle = '#8ea6ff';
            ctx.fillText(`PAGE ${this._menuPage + 1}/${pages}`, CANVAS_WIDTH / 2 + 80, CANVAS_HEIGHT - 74);
        }

        // 底部提示
        ctx.font = '15px Arial';
        ctx.fillStyle = '#9fb3d9';
        ctx.textAlign = 'center';
        ctx.fillText('方向键选择 · Enter/空格进入 · 总分：' + this.score, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40);
    }
    
    // 菜单卡片可见性（特殊关卡/测试地图受上线开关控制）
    _menuCardVisible(i) {
        if (i === LEVELS.length) return this._testMapVisible;    // 测试地图卡片
        const lvl = LEVELS[i];
        if (lvl && lvl.type === 'bonus' && !SHOW_SPECIAL_LEVELS) return false;
        return true;
    }

    // 挂锁图标（关卡未解锁标识）：锁梁上半圆 + 锁体 + 锁孔
    _drawLockIcon(ctx, cx, cy, size = 13) {
        ctx.save();
        ctx.strokeStyle = '#8a8f9e';
        ctx.fillStyle = '#8a8f9e';
        ctx.lineWidth = Math.max(2, size * 0.18);
        // 锁梁（上半圆弧）
        ctx.beginPath();
        ctx.arc(cx, cy - size * 0.18, size * 0.34, Math.PI, 0);
        ctx.stroke();
        // 锁体
        ctx.fillRect(cx - size * 0.5, cy - size * 0.18, size, size * 0.68);
        // 锁孔
        ctx.fillStyle = '#10101f';
        ctx.beginPath();
        ctx.arc(cx, cy + size * 0.12, size * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 菜单光标步进：自动跳过隐藏卡片 + 光标跨页自动翻页（delta 为 ±1 / ±cols）
    _menuStep(delta) {
        const total = LEVELS.length + 1;
        let cur = this.menuCursor;
        for (let k = 0; k < total; k++) {
            cur = (cur + delta + total) % total;
            if (this._menuCardVisible(cur)) break;
        }
        this.menuCursor = cur;
        this._menuPage = Math.floor(this.menuCursor / MENU_PER_PAGE);   // 光标跨页自动翻页
        if (typeof Sfx !== 'undefined') Sfx.play('menu');   // [C] 菜单光标音效
    }

    // 菜单按键处理（导航自动跳过隐藏卡片）
    menuKeyDown(code) {
        const cols = 4;
        switch (code) {
            case 'ArrowLeft': case 'KeyA':
                this._menuStep(-1);
                break;
            case 'ArrowRight': case 'KeyD':
                this._menuStep(1);
                break;
            case 'ArrowUp': case 'KeyW':
                this._menuStep(-cols);
                break;
            case 'ArrowDown': case 'KeyS':
                this._menuStep(cols);
                break;
            case 'Backquote':
                // 隐藏入口：` 键呼出/关闭测试地图卡片（上线后开发者专用）
                this._testMapVisible = !this._testMapVisible;
                if (!this._testMapVisible && this.menuCursor === LEVELS.length) this._menuStep(-1);
                console.log(`[Menu] 测试地图入口 ${this._testMapVisible ? '已呼出' : '已隐藏'}`);
                break;
            case 'Enter': case 'Space': case 'KeyJ':
                if (typeof Sfx !== 'undefined') Sfx.play('confirm');   // [C] 确认音效
                if (this.menuCursor === LEVELS.length && this._testMapVisible) {
                    console.log('[Menu] 选择测试地图');
                    this._startTestMap();
                } else if (this.menuCursor < LEVELS.length && this._menuCardVisible(this.menuCursor) &&
                           this.menuCursor <= this.unlockedIndex) {
                    console.log(`[Menu] 选择关卡: ${LEVELS[this.menuCursor].name}`);
                    this.loadLevel(this.menuCursor);
                } else {
                    console.log('[Menu] 关卡未解锁');
                }
                break;
        }
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
