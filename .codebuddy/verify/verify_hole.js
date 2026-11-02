// ============================================
// Owl 黑洞规则 - 无头验证脚本（加载真实游戏代码）
// 运行: node .codebuddy/verify/verify_hole.js
// ============================================
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', 'fn-js');
const FILES = ['env.js', 'ads.js', 'audio.js', 'levels.js', 'game.js', 'map.js', 'player.js', 'input.js', 'animation.js', 'fx.js', 'item.js', 'enemy.js', 'boss.js'];

// ---- 浏览器环境 mock ----
const mock = `
globalThis.window = globalThis;
globalThis.__loadHandler = null;
globalThis.__clickHandler = null;
globalThis.__fakeCanvas = null;   // 延迟到 CANVAS_WIDTH 定义后创建（见 test 段开头）
globalThis.window.addEventListener = function (type, fn) {
    if (type === 'load') globalThis.__loadHandler = fn;
};
globalThis.window.CRT = null;
globalThis.document = {
    getElementById: function (id) { return id === 'canvas1' ? globalThis.__fakeCanvas : null; },
    querySelector: function () { return null; },
    createElement: function (tag) {
        if (tag === 'canvas') {
            return {
                width: 0, height: 0,
                getContext: function () {
                    return {
                        drawImage: function () {}, fillRect: function () {}, clearRect: function () {},
                        getImageData: function (x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
                    };
                },
            };
        }
        return { appendChild: function () {}, style: {} };
    },
    addEventListener: function () {},
    readyState: 'complete',
    fonts: { load: function () {} }
};
globalThis.Image = class Image {
    constructor() { this.onload = null; this.complete = false; this.naturalWidth = 88; }
    set src(v) { this._s = v; this.complete = true; if (this.onload) this.onload(); }
    get src() { return this._s; }
};
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.localStorage = { getItem: function () { return null; }, setItem: function () {} };
`;

// ---- 拼接真实游戏代码（同浏览器脚本作用域）----
let code = FILES.map(f => fs.readFileSync(path.join(BASE, f), 'utf8')).join('\n;\n');

// ---- 测试用例 ----
const test = `
// ========== 测试开始 ==========
const results = [];
function T(name, cond) { results.push(cond); console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); }

// 初始化环境
map = new Map(null);
if (typeof map.initEmpty === 'function') map.initEmpty();
enemies.length = 0;
blackHoles.length = 0;
respawnQueue.length = 0;
items.length = 0;
player = new Player(3, 2);

// --- A: Owl 不在玩家脚下打洞 ---
player.gridX = 5; player.gridY = 3;
const owlA = new Owl(5, 3);
owlA.jumpTimer = 0;
owlA.update(50);
T('A: Owl 不在玩家脚下打洞', blackHoles.length === 0);

// --- B: Owl 独自站着正常打洞（防修复过度）---
const owlB = new Owl(6, 4);
owlB.jumpTimer = 0;
owlB.update(50);
T('B: Owl 空格正常打洞', blackHoles.length === 1 && isBlackHole(6, 4));
removeBlackHolesByOwner(owlB);   // 用真实恢复函数清理（恢复地板色，避免误判翻板）

// --- C: Owl 不在其他怪物脚下打洞 ---
const spiderC = new Spider(2, 2);
enemies.push(spiderC);           // 与游戏一致：工厂函数负责入列
spiderC.warning = 0;
const owlC = new Owl(2, 2);
owlC.jumpTimer = 0;
owlC.update(50);
T('C: Owl 不在其他怪物脚下打洞', blackHoles.length === 0);

// --- D: isTileFlipped 不再把黑洞当已翻板 ---
blackHoles.push({ col: 4, row: 2, owner: null });
T('D1: isTileFlipped(黑洞格)=false', map.isTileFlipped(4, 2) === false);
const snowD = new Snowman(1, 2);
snowD.warning = 0;
const tD = snowD._findFlippedTarget();
T('D2: 雪人不把黑洞当翻板目标', !(tD && tD.x === 4 && tD.y === 2));
map.tiles[5][7].color = map.flippedColor;   // 造一块真翻板格 (7,5)
const tD2 = snowD._findFlippedTarget();
T('D3: 雪人改选真翻板格', !!(tD2 && tD2.x === 7 && tD2.y === 5));

// --- E: 雪人长时间移动不进入黑洞格（黑洞挡在必经区域）---
snowD.gridX = 2; snowD.gridY = 2;
snowD.pixelX = OFFSET_X + 2 * CELL_SIZE; snowD.pixelY = OFFSET_Y + 2 * CELL_SIZE;
snowD.moveCooldown = 0;
let snowIn = false;
for (let i = 0; i < 600; i++) {
    snowD.update(16);
    if (snowD.gridX === 4 && snowD.gridY === 2) { snowIn = true; break; }
}
T('E: 雪人 600 帧模拟不进入黑洞格', !snowIn);

// --- F: 怪物复活出生点防黑洞 ---
enemies.length = 0;      // 清理前置用例怪物，排除 MAX_ENEMIES 上限干扰
MAX_ENEMIES = 99;
blackHoles.push({ col: 0, row: 0, owner: null });   // 出生点 (0,0) 被黑洞占据
respawnQueue.push({ type: 'Spider', col: 0, row: 0, timer: 100, spawned: false });
for (let i = 0; i < 20; i++) processRespawn(50);
T('F1: 出生点是黑洞 → 推迟复活', respawnQueue.length === 1 && !respawnQueue[0].spawned);
blackHoles.length = 0;
for (let i = 0; i < 30; i++) processRespawn(50);
T('F2: 黑洞消失后正常复活', respawnQueue.length === 0 && enemies.length > 0);

// --- G: 玩家重生避黑洞（默认重生点 (3,3) 被黑洞占据 → 改落最近可用格）---
enemies.length = 0;          // 自包含：清环境（前置用例残留的怪物/障碍会干扰最近格选择）
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    map.boxGrid[r][c] = false; map.stoneGrid[r][c] = false; map.wallGrid[r][c] = false;
}
blackHoles.length = 0;
blackHoles.push({ col: 3, row: 3, owner: null });
player.respawn();
const gDist = Math.abs(player.gridX - 3) + Math.abs(player.gridY - 3);
T('G: 玩家重生改落最近可用格（不落黑洞、曼哈顿距离1）',
    !isBlackHole(player.gridX, player.gridY) && map.canMoveTo(player.gridX, player.gridY) && gDist === 1);
blackHoles.length = 0;

// --- H: 幽灵长时间移动不进入黑洞格 ---
blackHoles.push({ col: 2, row: 1, owner: null });
const ghostH = new Ghost(0, 1);
ghostH.warning = 0;
ghostH.moveCooldown = 0;
player.gridX = 6; player.gridY = 5;
let ghostIn = false;
for (let i = 0; i < 400; i++) {
    ghostH.update(16);
    if (ghostH.gridX === 2 && ghostH.gridY === 1) { ghostIn = true; break; }
}
T('H: 幽灵 400 帧模拟不进入黑洞格', !ghostIn);

// --- I: 幽灵无目标（与玩家同格）→ 自由游荡不站桩 ---
enemies.length = 0;
blackHoles.length = 0;
const ghostI = new Ghost(7, 0);
enemies.push(ghostI);
ghostI.warning = 0; ghostI.moveCooldown = 0;
player.gridX = 7; player.gridY = 0;   // 同格 → findPath 返回 null（修复前：站着不动）
let movedI = false;
for (let i = 0; i < 200; i++) {
    ghostI.update(16);
    if (ghostI.gridX !== 7 || ghostI.gridY !== 0) { movedI = true; break; }
}
T('I: 幽灵无目标时自由游荡（不站桩）', movedI);

// --- J: 玩家被黑洞完全围住（目标不可达）→ 游荡 ---
map.tiles[5][7].color = map.cellColor;   // 恢复 D3 残留翻板格，确保场上无任何翻板目标
blackHoles.push({ col: 4, row: 1, owner: null }, { col: 6, row: 1, owner: null },
                { col: 5, row: 0, owner: null }, { col: 5, row: 2, owner: null });
player.gridX = 5; player.gridY = 1;      // 玩家四周全是黑洞，BFS 不可达
const ghostJ = new Ghost(0, 0);
enemies.push(ghostJ);
ghostJ.warning = 0; ghostJ.moveCooldown = 0;
let movedJ = false;
for (let i = 0; i < 300; i++) {
    ghostJ.update(16);
    if (ghostJ.gridX !== 0 || ghostJ.gridY !== 0) { movedJ = true; break; }
}
T('J: 玩家不可达时幽灵仍游荡', movedJ);

// --- K: 有翻板目标时正常寻路接近（游荡不干扰主逻辑）---
blackHoles.length = 0;
map.tiles[2][4].color = map.flippedColor;   // (4,2) 翻板格
const ghostK = new Ghost(4, 5);
enemies.push(ghostK);
ghostK.warning = 0; ghostK.moveCooldown = 0;
player.gridX = 0; player.gridY = 0;
let minDist = 99;
for (let i = 0; i < 400; i++) {
    ghostK.update(16);
    minDist = Math.min(minDist, Math.abs(ghostK.gridX - 4) + Math.abs(ghostK.gridY - 2));
}
T('K: 有翻板目标时正常寻路接近', minDist <= 2);

// --- L: 测试地图 G 键一键清除全部怪物 ---
blackHoles.length = 0;
globalThis.__fakeCanvas = {
    getContext: function () {
        const gradStub = { addColorStop: function () {} };   // 渐变对象桩（addColorStop 链式）
        return new Proxy({}, {
            get: function (t, prop) {
                if (prop === 'createLinearGradient' || prop === 'createRadialGradient' ||
                    prop === 'createPattern') return function () { return gradStub; };
                return function () {};
            },
            set: function () { return true; }
        });
    },
    addEventListener: function (type, fn) {
        if (type === 'click') globalThis.__clickHandler = fn;
        if (type === 'mousemove') globalThis.__moveHandler = fn;
    },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }; }
};
__loadHandler();          // 触发 window load → new Game()
game.testMode = true;
enemies.length = 0;
respawnQueue.length = 0;
const s1 = new Spider(1, 1); enemies.push(s1); s1.alive = true; s1.warning = 0;
const o1 = new Owl(2, 2);    enemies.push(o1); o1.alive = true; o1.warning = 0;
game.testKeyDown('KeyG');
T('L1: G 键一键清除全部怪物', enemies.length === 0);
game.testKeyDown('KeyG');
T('L2: 空场再按 G 不报错', enemies.length === 0);
for (let i = 0; i < 10; i++) processRespawn(50);
T('L3: 清除的怪物不进复活队列', respawnQueue.length === 0 && enemies.length === 0);

// --- M: C 键一键清除全部物件 ---
map.stoneGrid[3][1] = true;
map.boxGrid[4][1] = true;
map.wallGrid[5][1] = true;
map.boxNeverPushed.add('4,1');
const owlHoleTile = map.tiles[6][1];           // 模拟 Owl 洞（地板被染黑）
owlHoleTile.color = '#000'; owlHoleTile.borderColor = '#222';
blackHoles.push({ col: 1, row: 6, owner: null });
blackHoles.push({ col: 1, row: 6 + 1, owner: null, prevColor: '#d0d0d0', prevBorder: '#808080' });
blackHoles[blackHoles.length - 1].row = 6;      // 合并为一个带 prevColor 的洞（占位行 6 重复无妨，测恢复逻辑）
game.testKeyDown('KeyC');
let objClear = true;
for (let r = 0; r < ROWS && objClear; r++)
    for (let c = 0; c < COLS && objClear; c++)
        if (map.stoneGrid[r][c] || map.boxGrid[r][c] || map.wallGrid[r][c]) objClear = false;
T('M1: C 键清空石头/箱子/墙', objClear);
T('M2: C 键清空黑洞列表', blackHoles.length === 0);
T('M3: Owl 洞地板颜色已恢复', owlHoleTile.color === '#d0d0d0' && owlHoleTile.borderColor === '#808080');

// --- N: 翻板行为（回退后保留原始手感：滑动中按 J 以逻辑格为中心生效）---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
map.tiles[5][7].color = map.cellColor;   // 复原此前用例染色的格子
map.tiles[2][4].color = map.cellColor;
player.gridX = 3; player.gridY = 2;
player.isMoving = false;

// N1: 站定翻板 → 玩家格入队
player.flipCurrentTile();
T('N1: 站定翻板正常入队', pendingFlips.length >= 1 && pendingFlips.some(pf => pf.col === 3 && pf.row === 2));

// N2: 动画未播完期间重复点击 → 不重复入队（用户方案：不重复播放动画）
player.flipCurrentTile();
T('N2: 动画期间重复点击不重复播放', pendingFlips.length === 1);

// N3: 滑动中按 J 仍生效（原始手感保留：以逻辑格为中心，新格正常入队）
player.gridX = 4; player.gridY = 2;   // 模拟滑动中逻辑格已提前指向下一格
player.isMoving = true;
player.flipCurrentTile();
T('N3: 滑动中按 J 保留原始手感（新格正常入队）', pendingFlips.some(pf => pf.col === 4 && pf.row === 2));
player.isMoving = false;

// N4: 延迟翻转执行后 → 可正常反向翻转（灰→白）
updatePendingFlips(1200);
T('N4a: 延迟翻转执行完毕', pendingFlips.length === 0);
player.gridX = 3; player.gridY = 2;   // 复位玩家位置（N3 模拟滑动时偏移到了 4）
player.flipCurrentTile();
const n4 = pendingFlips.find(pf => pf.col === 3 && pf.row === 2);
T('N4b: 播完后再按正常反向翻转', !!(n4 && n4.newColor === map.cellColor));

// --- O: 投掷硬直怪物飞出地图 ---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
map.tiles[5][7].color = map.cellColor;
map.tiles[2][4].color = map.cellColor;
player = new Player(3, 2);              // 干净玩家，默认朝上 (0,-1)
player.isMoving = false;

// O1: 拾取并投掷（朝上，列 3 上方无障碍）→ 应飞出地图外
const sp = new Spider(3, 2);
enemies.push(sp);
sp.alive = true; sp.warning = 0;
sp.stunned = ENEMY_STUN_DURATION;
sp.gridX = 3; sp.gridY = 2;
sp.pixelX = OFFSET_X + 3 * CELL_SIZE + BORDER_WIDTH;
sp.pixelY = OFFSET_Y + 2 * CELL_SIZE + BORDER_WIDTH;
player.carriedGhost = sp;
sp.carried = true;
player.interactGhost();                 // 手中有怪 → 投掷
T('O0: 投掷后进入飞行状态', sp.flying === true && sp.carried === false && player.carriedGhost === null);
let frames = 0;
while (sp.alive && frames < 400) { sp.update(16); frames++; }
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }   // 模拟主循环清理
T('O1: 投掷后怪物飞出地图外死亡', sp.alive === false && frames < 400);
T('O2: 飞出地图的怪物进复活队列（正常重生）', respawnQueue.length === 1);

// O3: 飞行中的怪物不可被再次拾取（防止扔出去又被吸回来）
const sp2 = new Spider(5, 4);
enemies.push(sp2);
sp2.alive = true; sp2.warning = 0;
sp2.stunned = 4000; sp2.flying = true;  // 投掷后的飞行状态
sp2.gridX = 3; sp2.gridY = 2;           // 恰好经过玩家格
sp2.pixelX = player.pixelX; sp2.pixelY = player.pixelY;
player.carriedGhost = null;
player.interactGhost();                 // 拾取尝试
T('O3: 飞行中的怪物不可被拾取', player.carriedGhost === null && enemies.some(e => e === sp2));

// O4: 投掷撞到障碍 → 落地保持硬直（可再被拾取换方向扔，保留的设计）
map.boxGrid[3][3] = true;               // M 段 C 键清光了箱子，此处重放一个
map.boxNeverPushed.delete('3,3');
const sp3 = new Spider(3, 2);
enemies.push(sp3);
sp3.alive = true; sp3.warning = 0;
sp3.stunned = 4000; sp3.flying = true;
sp3.pixelX = OFFSET_X + 3 * CELL_SIZE + BORDER_WIDTH;
sp3.pixelY = OFFSET_Y + 2 * CELL_SIZE + BORDER_WIDTH;
sp3.gridX = 3; sp3.gridY = 2;
sp3.flyDx = 0; sp3.flyDy = 1;           // 朝下投掷，(3,3) 有箱子
frames = 0;
while (sp3.flying && frames < 200) { sp3.update(16); frames++; }
T('O4: 投掷撞障碍落地保持硬直（可再拾取）', sp3.alive === true && sp3.flying === false && sp3.stunned > 0);

// --- P: 击杀后复活链路 ---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
MAX_ENEMIES = 5;

// P1: 直接 killEnemy（炸弹 killAllEnemies 同路径）→ 应入复活队列
const k1 = new Spider(1, 1);
enemies.push(k1); k1.alive = true; k1.warning = 0;
killEnemy(k1);
T('P1: killEnemy 后入复活队列', respawnQueue.length === 1);

// P2: 推箱推出地图外（alive=false → 清理循环）→ 应入复活队列
const k2 = new Spider(2, 4);
enemies.push(k2); k2.alive = true; k2.warning = 0;
k2.alive = false;
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
T('P2: 推箱击杀后入复活队列', respawnQueue.length === 2);

// P3: 被撞飞出界（撞飞流程会设置 bouncing=true）→ 死亡且保留复活
const k3 = new Spider(3, 3);
enemies.push(k3); k3.alive = true; k3.warning = 0;
k3.stunned = 0; k3.flying = true; k3.bouncing = true;   // 模拟被撞飞（撞飞流程设置 bouncing）
k3.pixelX = OFFSET_X + 3 * CELL_SIZE; k3.pixelY = OFFSET_Y - CELL_SIZE * 1.5;
k3.gridX = 3; k3.gridY = -1;
k3.flyDx = 0; k3.flyDy = -1;
k3.update(16);
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }   // 模拟主循环清理
T('P3: 被撞飞出界正常死亡并保留复活（不再被误标 _thrownOut）', k3.alive === false && k3._thrownOut !== true && respawnQueue.length === 3);

// P4: 复活队列全链路：推进 13s → 生成预警怪物
const cntBefore = enemies.length;
for (let t = 0; t < 13000; t += 50) processRespawn(50);
T('P4: 复活队列推进后怪物生成（预警）', enemies.length > cntBefore);

// P5: 出生点黑洞 → 复活推迟（保护逻辑工作正常）
respawnQueue.push({ type: 'Owl', col: 0, row: 0, timer: 100, spawned: false });
blackHoles.push({ col: 0, row: 0, owner: null });
const qLen = respawnQueue.length;
for (let t = 0; t < 500; t += 50) processRespawn(50);
T('P5: 出生点黑洞时复活推迟', respawnQueue.length === qLen);

// --- Q: 幽灵死亡→重生全链路 ---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
MAX_ENEMIES = 5;

// Q1: 幽灵被推箱推出界（alive=false → 清理循环）→ 应入队并生成新幽灵
const gq1 = new Ghost(1, 1);
enemies.push(gq1); gq1.alive = true; gq1.warning = 0;
gq1.alive = false;
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
T('Q1a: 幽灵推箱击杀入复活队列', respawnQueue.length === 1 && respawnQueue[0].type === 'Ghost');
for (let t = 0; t < 13000; t += 50) processRespawn(50);
const newGhost = enemies.find(e => e.name === 'Ghost' && e !== gq1);
T('Q1b: 推进 13s 后新幽灵生成（预警中）', !!newGhost && newGhost.warning >= 0 && enemies.includes(newGhost));

// Q2: 幽灵被投掷出界 → 统一走复活逻辑（所有怪物一致）
const gq2 = new Ghost(2, 2);
enemies.push(gq2); gq2.alive = true; gq2.warning = 0;
gq2.stunned = 4000; gq2.flying = true;
gq2.pixelX = OFFSET_X + 2 * CELL_SIZE; gq2.pixelY = OFFSET_Y - CELL_SIZE * 1.5;
gq2.gridX = 2; gq2.gridY = -1;
gq2.flyDx = 0; gq2.flyDy = -1;
gq2.update(16);
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
const q2Queue = respawnQueue.filter(rq => rq.type === 'Ghost').length;
T('Q2: 幽灵被投掷出界正常入复活队列（所有怪物统一）', gq2._thrownOut === undefined && q2Queue === 1);

// Q3: 幽灵被撞飞出界（bouncing=true）→ 应复活
const gq3 = new Ghost(3, 3);
enemies.push(gq3); gq3.alive = true; gq3.warning = 0;
gq3.stunned = 0; gq3.flying = true; gq3.bouncing = true;
gq3.pixelX = OFFSET_X + 3 * CELL_SIZE; gq3.pixelY = OFFSET_Y - CELL_SIZE * 1.5;
gq3.gridX = 3; gq3.gridY = -1;
gq3.flyDx = 0; gq3.flyDy = -1;
gq3.update(16);
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
T('Q3: 幽灵被撞飞出界后入复活队列', respawnQueue.some(rq => rq.type === 'Ghost' && rq.col === 3));

// --- R: 玩家死亡动画链（受伤 1.5s 后生成角色 / 命尽 game over）---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
map.boxGrid[3][3] = false; map.stoneGrid[3][3] = false; map.wallGrid[3][3] = false;   // 清出生点（防前置段残留导致构造落位偏移）
player = new Player(3, 3);   // 出生点已改 (3,3)（第4行第4列）
player.isMoving = false;
if (game) game.gameOver = false;

// R1: 第一次受伤 → 进入死亡链（受伤重生型），不立即重生
const px0 = player.pixelX, py0 = player.pixelY;
player.takeDamage(1);
T('R1: 第一次受伤进入死亡链（未立即重生）', player.dying === true && player.deathFinal === false &&
    player.lives === 1 && player.pixelX === px0 && player.pixelY === py0);

// R2: 动画期间再受击 → 不重复扣血
player.invTimer = 0;
player.takeDamage(1);
T('R2: 死亡动画期间免疫重复扣血', player.lives === 1 && player.deathFinal === false);

// R3: 快进 1.6s → 链尾生成角色（回起点、清死亡状态、解锁移动）
player.deathStart = performance.now() - 1600;
player.update(16);
T('R3: 1.5s 动画结束生成角色（dying 清除 + 回起点）', player.dying === false &&
    player.gridX === 3 && player.gridY === 3 && player.move === Player.prototype.move);

// R4: 命尽 → 最终死亡链 → game over
player.invTimer = 0;
player.takeDamage(1);
T('R4a: 命尽进入最终死亡链', player.dying === true && player.deathFinal === true);
player.deathStart = performance.now() - 2600;
player.update(16);
T('R4b: 最终死亡链尾触发 game over', !!game && game.gameOver === true);
if (game) game.gameOver = false;

// --- T: 硬直怪物 × 飞行怪物 撞击矩阵 ---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
MAX_ENEMIES = 9;

// 辅助：创建一只朝右飞行的投掷怪
function makeFlyer(col, row) {
    const f = new Spider(col, row);
    enemies.push(f);
    f.alive = true; f.warning = 0; f.stunned = 4000; f.flying = true; f.bouncing = false;
    f.moveSpeed = THROW_FLY_SPEED;       // 模拟 _throwGhost：投掷飞行速度 1px/ms
    f.pixelX = OFFSET_X + col * CELL_SIZE + BORDER_WIDTH;
    f.pixelY = OFFSET_Y + row * CELL_SIZE + BORDER_WIDTH;
    f.gridX = col; f.gridY = row;
    f.flyDx = 1; f.flyDy = 0;
    return f;
}
// 辅助：创建一只躺地硬直怪
function makeStunned(col, row) {
    const s = new Ghost(col, row);
    enemies.push(s);
    s.alive = true; s.warning = 0; s.stunned = 4000; s.flying = false;
    s.pixelX = OFFSET_X + col * CELL_SIZE + BORDER_WIDTH;
    s.pixelY = OFFSET_Y + row * CELL_SIZE + BORDER_WIDTH;
    s.gridX = col; s.gridY = row;
    return s;
}
// 推进飞行怪若干帧
function flyFrames(f, n) { for (let i = 0; i < n && f.alive && f.flying; i++) f.update(16); }

// T1: 飞行怪穿过硬直怪所在格 → 硬直怪一起被撞飞（新规则：连硬直怪一起扔出地图）
const t1fly = makeFlyer(1, 2);
const t1sit = makeStunned(3, 2);        // 路径正前方
flyFrames(t1fly, 40);
T('T1: 飞行怪撞到硬直怪，硬直怪一起被撞飞', t1sit.flying === true && t1sit.bouncing === true);

// T2: 飞行怪穿过"硬直刚恢复"（stunned=0）的怪 → 被撞飞（正常规则；用无障碍的 row 0）
const t2fly = makeFlyer(1, 0);
const t2up = makeStunned(3, 0);
t2up.stunned = 0;                        // 硬直刚好结束
flyFrames(t2fly, 40);
T('T2: 硬直恢复的怪被撞飞（正常）', t2up.flying === true);

// T3: 两只飞行怪相向而行互撞 → 各自状态合法
const t3a = makeFlyer(1, 4);
const t3b = makeFlyer(4, 4);
t3b.flyDx = -1;                          // 相向飞行
flyFrames(t3a, 60);
T('T3: 飞行怪互撞后状态合法', enemies.every(e => e.alive === true || e.alive === false));

// T4: 飞行怪穿过"玩家举着"的怪物格 → carried 怪不被撞飞
const t4fly = makeFlyer(1, 5);
const t4car = makeStunned(3, 5);
t4car.carried = true;                     // 模拟被举着（在路径上）
flyFrames(t4fly, 40);
T('T4: carried 怪不被飞行怪撞飞', t4car.flying === false);

// T5: 被撞飞的硬直怪飞出地图后 → 正常走复活队列
flyFrames(t1sit, 200);   // 继续飞到出界
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
T('T5: 被撞飞出界的硬直怪正常复活', respawnQueue.some(rq => rq.type === 'Ghost'));

// T6: 起飞格上有躺地怪 → 不触发反弹，投掷正常飞走（起飞格跳过撞击判定）
const t6fly = makeFlyer(1, 6);
const t6sit = makeStunned(1, 6);        // 起飞格上趴着一只
flyFrames(t6fly, 60);
T('T6: 起飞格躺地怪不导致反弹，投掷正常飞走（出界死亡）', t6sit.flying === false && t6fly.alive === false);

// T7: 投掷怪撞到硬直怪 → 硬直怪被撞飞 + 投掷怪不反弹，双方一起飞出地图
const t7fly = makeFlyer(1, 3);
const t7sit = makeStunned(3, 3);        // 路径正前方的躺地硬直怪
flyFrames(t7fly, 12);                    // 飞到 (3,3) 撞上（速度 1px/ms，约 2 格）
T('T7a: 投掷怪撞硬直怪后不反弹', t7fly.bouncing === false && t7fly.flying === true);
T('T7b: 硬直怪被一起撞飞', t7sit.flying === true && t7sit.bouncing === true);
flyFrames(t7fly, 400);                   // 投掷怪继续飞到出界
flyFrames(t7sit, 400);                   // 被撞飞的硬直怪同步推进到出界
for (let i = enemies.length - 1; i >= 0; i--) { if (!enemies[i].alive) killEnemy(enemies[i]); }
T('T7c: 双方出界死亡并进复活队列（一起出地图）',
    t7fly.alive === false && t7sit.alive === false &&
    respawnQueue.filter(rq => rq.type === 'Spider' || rq.type === 'Ghost').length >= 2);

// --- U: 测试地图 F 键一键全场怪物硬直 ---
enemies.length = 0;
const u1 = new Spider(1, 1); enemies.push(u1); u1.alive = true; u1.warning = 0; u1.stunned = 0;
const u2 = new Ghost(2, 2);  enemies.push(u2); u2.alive = true; u2.warning = 0; u2.stunned = 0;
game.testKeyDown('KeyF');
T('U1: F 键全场怪物硬直', u1.stunned === ENEMY_STUN_DURATION && u2.stunned === ENEMY_STUN_DURATION);
game.testKeyDown('KeyF');
T('U2: 空场再按 F 不报错', enemies.length === 0 || enemies.every(e => e.stunned > 0));

// U3: 测试地图道具命名完整性——TEST_ITEM_TYPES 每项都有中文名（避免显示 undefined）
const missingNames = TEST_ITEM_TYPES.filter(k => !TEST_TOOL_NAMES[k]);
T('U3: 测试地图道具命名齐全（无 undefined）', missingNames.length === 0);

// U4: TEST_ITEM_TYPES 中每项都是 ITEM_TYPES 里存在的合法道具
const invalidItems = TEST_ITEM_TYPES.filter(k => !ITEM_TYPES[k]);
T('U4: 测试道具列表均存在于 ITEM_TYPES', invalidItems.length === 0);

// U5: [I] 循环切换全部道具，命名均可解析
let cycleOK = true;
for (const k of TEST_ITEM_TYPES) {
    if (!TEST_TOOL_NAMES[k]) { cycleOK = false; break; }
}
T('U5: [I] 循环切换道具命名均可解析', cycleOK);

// --- B: 界面电玩化回归 ---
// B0: addScore 精确累加（防双重加分回归）+ HI-SCORE 刷新
if (game) { game.score = 0; game._hiScore = 0; }
game.addScore(100);
game.addScore(50);
T('B0: addScore 精确累加（无双重加分）', game.score === 150);
T('B0b: HI-SCORE 随分刷新', game._hiScore === 150);
if (typeof localStorage !== 'undefined') { try { localStorage.setItem('fn_hi', '0'); } catch (err) {} }

// --- V: 翻转卡 flip1（相邻两行横翻）/ flip2（相邻3列纵翻）---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
MAX_ENEMIES = 9;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!map.stoneGrid[r][c] && !map.wallGrid[r][c] && !map.boxGrid[r][c] && !isBlackHole(c, r)) {
        map.tiles[r][c].color = map.cellColor;   // 全图复原为白
    }
}
player = new Player(4, 3);
player.lastDy = 1;           // 朝下 → flip1 相邻行取下一行 (4)
player.isMoving = false;
items.length = 0;

// V1: 全白图 → 优先逻辑退化为普通随机（恰好两行翻转）
const c1 = new Item('flip1', 0, 0);
c1.onPickup();
updatePendingFlips(1200);   // 覆盖涟漪最大延迟
const rowState = [];
for (let r = 0; r < ROWS; r++) {
    let gray = 0, total = 0;
    for (let c = 0; c < COLS; c++) {
        if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
        total++;
        if (map.tiles[r][c].color === map.flippedColor) gray++;
    }
    rowState.push({ gray, total, full: total > 0 && gray === total });
}
const fullRows = rowState.map((x, i) => x.full ? i : -1).filter(i => i >= 0);
T('V1: 全白图随机翻转两行', fullRows.length === 2);

// V2: 优先未翻转的行——row0/1 预翻灰、其余白 → flip1 只从白行（row2-6）随机抽 2 行
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    map.tiles[r][c].color = (r <= 1) ? map.flippedColor : map.cellColor;   // row0/1 灰、row2-6 白
}
pendingFlips.length = 0;
const cp = new Item('flip1', 0, 0);
cp.onPickup();
const rowsHit = new Set(pendingFlips.map(pf => pf.row));
T('V2: 优先未翻转的行（灰行不选、恰好命中 2 个不同白行）',
    rowsHit.size === 2 && [...rowsHit].every(r => r >= 2) &&
    pendingFlips.every(pf => pf.row >= 2) &&
    pendingFlips.every(pf => map.tiles[pf.row][pf.col].color === map.cellColor));
updatePendingFlips(1200);

// V2: flip2 → 恰好随机翻转 3 个不同列（不要求相邻，其余列保持白）
const c2 = new Item('flip2', 0, 0);
c2.onPickup();
updatePendingFlips(1200);
const colState = [];
for (let c = 0; c < COLS; c++) {
    let gray = 0, total = 0;
    for (let r = 0; r < ROWS; r++) {
        if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
        total++;
        if (map.tiles[r][c].color === map.flippedColor) gray++;
    }
    colState.push({ gray, total, full: total > 0 && gray === total });
}
const fullCols = colState.map((x, i) => x.full ? i : -1).filter(i => i >= 0);
T('V2: flip2 恰好随机翻转3列（其余列保持白）', fullCols.length === 3);

// V3: 白行不足 2 行时 → 优先翻转最后剩余的白行（从灰行随机补位，无实际效果）
pendingFlips.length = 0;
for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!map.stoneGrid[r][c] && !map.wallGrid[r][c] && !map.boxGrid[r][c] && !isBlackHole(c, r))
        map.tiles[r][c].color = map.flippedColor;   // row1-6 预翻灰，仅 row0 剩白格
}
const c3 = new Item('flip1', 0, 0);
c3.onPickup();
updatePendingFlips(1200);
let v3OK = true;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    if (map.tiles[r][c].color !== map.flippedColor) v3OK = false;
}
T('V3: 白行不足时优先翻转剩余白行（row0 被翻，全场完成）', v3OK);

// V4: 全灰图 flip1 → 无白行可优先，随机补位无实际效果、不报错
const c4 = new Item('flip1', 0, 0);
c4.onPickup();
updatePendingFlips(1200);
let v4OK = true;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    if (map.tiles[r][c].color !== map.flippedColor) v4OK = false;
}
T('V4: 全灰图 flip1 无变化不报错', v4OK);

// --- W: 翻转卡涟漪优先级（直调 flipRowInstant：靠近已翻转格的白格先翻）---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
for (let c = 0; c < COLS; c++) {
    if (!map.stoneGrid[0][c] && !map.wallGrid[0][c] && !map.boxGrid[0][c] && !isBlackHole(c, 0))
        map.tiles[0][c].color = map.cellColor;
}
map.tiles[0][2].color = map.flippedColor;   // 灰格锚点 (2,0)
pendingFlips.length = 0;
flipRowInstant(0, 4);                        // 玩家 col4（无灰格时的备用起点）
const dCol5 = pendingFlips.find(pf => pf.row === 0 && pf.col === 5);
const dCol7 = pendingFlips.find(pf => pf.row === 0 && pf.col === 7);
T('W1: 涟漪优先级——靠近灰格锚点的白格先翻（col5 < col7）', !!dCol5 && !!dCol7 && dCol5.delay < dCol7.delay);

// W2: 无灰格的行 → 以玩家列起点
updatePendingFlips(1500);   // 先执行完 W1 的涟漪（否则清空 pending 会丢掉 row0 的翻转）
for (let c = 0; c < COLS; c++) {
    if (!map.stoneGrid[1][c] && !map.wallGrid[1][c] && !map.boxGrid[1][c] && !isBlackHole(c, 1))
        map.tiles[1][c].color = map.cellColor;
}
pendingFlips.length = 0;
flipRowInstant(1, 4);
const eCol5 = pendingFlips.find(pf => pf.row === 1 && pf.col === 5);
const eCol7 = pendingFlips.find(pf => pf.row === 1 && pf.col === 7);
T('W2: 无灰格行以玩家位置为涟漪起点（col5 < col7）', !!eCol5 && !!eCol7 && eCol5.delay < eCol7.delay);

// W3: 涟漪结束后全部翻转完成
updatePendingFlips(1500);
T('W3: 涟漪结束后全部翻转完成', map.tiles[0][5].color === map.flippedColor && map.tiles[1][5].color === map.flippedColor);

// W4: areAllFlipped 通关判定恢复（修复 return false 被注释导致的"一进关就通关"失效）
map.boxNeverPushed.add('3,3');   // O4 手动放的箱子 (3,3) 登记豁免（真实流程由 placeBoxes 登记）
for (let r = 2; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    map.tiles[r][c].color = map.cellColor;   // 复原 row2-6 为白（部分翻转场景）
}
T('W4: 部分翻转时 areAllFlipped=false（通关判定恢复）', map.areAllFlipped() === false);

// W5: 全部可翻格翻转后 areAllFlipped=true（障碍/黑洞/未推箱子豁免）
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    map.tiles[r][c].color = map.flippedColor;
}
T('W5: 全部翻转后 areAllFlipped=true', map.areAllFlipped() === true);

// --- V2f: flip2 优先未翻转的列（随机 3 列，不要求相邻）---
// V2f-a: 全白图 → 恰好随机 3 个不同列（其余列保持白）
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!map.stoneGrid[r][c] && !map.wallGrid[r][c] && !map.boxGrid[r][c] && !isBlackHole(c, r))
        map.tiles[r][c].color = map.cellColor;
}
pendingFlips.length = 0;
const c2f = new Item('flip2', 0, 0);
c2f.onPickup();
updatePendingFlips(1200);   // 推进涟漪后再统计
const fullColsF = [];
for (let c = 0; c < COLS; c++) {
    let gray = 0, total = 0;
    for (let r = 0; r < ROWS; r++) {
        if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
        total++;
        if (map.tiles[r][c].color === map.flippedColor) gray++;
    }
    if (total > 0 && gray === total) fullColsF.push(c);
}
T('V2f-a: flip2 恰好随机翻转3列（其余列保持白）', fullColsF.length === 3);

// V2f-b: 优先未翻转的列——col0/1/2 预翻灰（5 白列）→ flip2 抽的 3 列全来自白列
blackHoles.length = 0;
pendingFlips.length = 0;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    map.tiles[r][c].color = (c <= 2) ? map.flippedColor : map.cellColor;   // col0-2 灰、col3-7 白
}
const c2b = new Item('flip2', 0, 0);
c2b.onPickup();
const colsHit = new Set(pendingFlips.map(pf => pf.col));
T('V2f-b: 优先未翻转的列（灰列不选、恰好随机 3 个不同白列）',
    colsHit.size === 3 && [...colsHit].every(c => c > 2) &&
    pendingFlips.every(pf => map.tiles[pf.row][pf.col].color === map.cellColor));
updatePendingFlips(1200);

// V2f-c: 白列不足 3 列（仅 col6/7 白）→ 优先翻转剩余白列 + 灰列补位（补位无实际效果）
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    map.tiles[r][c].color = (c >= 6) ? map.cellColor : map.flippedColor;   // 仅 col6/7 白
}
pendingFlips.length = 0;
const c2c = new Item('flip2', 0, 0);
c2c.onPickup();
const colsHit2 = new Set(pendingFlips.map(pf => pf.col));
T('V2f-c: 白列不足 3 列时优先翻转剩余白列（col6/7 必选，灰列补位无白格可翻）',
    colsHit2.has(6) && colsHit2.has(7) && colsHit2.size === 2);
updatePendingFlips(1200);

// V2f-d: 全灰图 flip2 → 无变化不报错
const c2d = new Item('flip2', 0, 0);
c2d.onPickup();
updatePendingFlips(1200);
let v2dOK = true;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (map.stoneGrid[r][c] || map.wallGrid[r][c] || map.boxGrid[r][c] || isBlackHole(c, r)) continue;
    if (map.tiles[r][c].color !== map.flippedColor) v2dOK = false;
}
T('V2f-d: 全灰图 flip2 无变化不报错', v2dOK);

// --- F: 电玩特效层（浮动文字 / 爆裂粒子）---
floatTexts.length = 0;
bursts.length = 0;

// F1: 浮动文字生成与生命周期
spawnFloatText(2, 2, '+100');
T('F1: 浮动文字入列', floatTexts.length === 1);
updateFloatTexts();
T('F1b: 未超时不清除', floatTexts.length === 1);

// F2: 爆裂粒子生成与重力位移
spawnBurst(2, 2, ['#ffffff'], 10);
T('F2: 爆裂粒子 10 颗', bursts.length === 1 && bursts[0].parts.length === 10);
updateBursts(100);
T('F2b: 粒子受推进产生位移', bursts[0].parts.every(p => p.y !== 0 || p.x !== 0));

// F3: 超时清除（快进 born）
floatTexts[0].born -= 1000;
updateFloatTexts();
T('F3: 超时浮动文字清除', floatTexts.length === 0);

// --- Y: 箱子伪 3D 深度分层（修复"箱子推到玩家下方时透视玩家"BUG）---
map.boxImageLoaded = true;   // mock 环境同步 onload 时序问题，手动置位
map.boxGrid[6][1] = true;   // 箱子在 (1,6)——玩家 (1,5) 的下方一格（应遮挡玩家下半身）
map.boxGrid[4][1] = true;   // 箱子在 (1,4)——玩家 (1,5) 的上方两格（应被玩家遮挡）
const drawnY = [];
map.ctx = { drawImage: (img, sx, sy, sw, sh, dx, dy) => drawnY.push(dy) };
const pBottomY = OFFSET_Y + 5 * CELL_SIZE + 77;   // 玩家在 (1,5) 的 sprite 底部

map.drawBoxesSplit(pBottomY, false);   // 远景层
T('Y1: 远景层画玩家上方的箱子、不画玩家下方的箱子',
    drawnY.includes(OFFSET_Y + 4 * CELL_SIZE) && !drawnY.includes(OFFSET_Y + 6 * CELL_SIZE));

drawnY.length = 0;
map.drawBoxesSplit(pBottomY, true);    // 近景层
T('Y2: 近景层画玩家下方的箱子、不画玩家上方的箱子',
    drawnY.includes(OFFSET_Y + 6 * CELL_SIZE) && !drawnY.includes(OFFSET_Y + 4 * CELL_SIZE));

// Y3: 全量绘制（drawBoxes）保持原行为（菜单/其他调用不受影响）
drawnY.length = 0;
map.drawBoxes();
T('Y3: drawBoxes() 全量绘制箱子（兼容原调用）',
    drawnY.includes(OFFSET_Y + 4 * CELL_SIZE) && drawnY.includes(OFFSET_Y + 6 * CELL_SIZE));
map.ctx = null;





// --- O: 菜单上线开关与隐藏入口 ---
game.mode = 'menu';
game.menuCursor = 0;
T('O1: 普通关卡卡片可见', game._menuCardVisible(0) === true);
T('O2: bonus 卡片可见（SHOW_SPECIAL_LEVELS=true）', game._menuCardVisible(4) === true);   // 索引4=BONUS 1
T('O3: 默认测试地图卡片可见（SHOW_TEST_MAP=true）', game._menuCardVisible(LEVELS.length) === true);
// O4: 光标在测试卡片上按反引号键 → 隐藏 + 光标自动移开
game.menuCursor = LEVELS.length;
game.menuKeyDown('Backquote');
T('O4: 反引号键隐藏测试卡片并移开光标', game._testMapVisible === false && game.menuCursor !== LEVELS.length);
T('O5: 隐藏后测试卡片不可见', game._menuCardVisible(LEVELS.length) === false);
// O6: 再按反引号键重新呼出
game.menuKeyDown('Backquote');
T('O6: 再按反引号键重新呼出', game._testMapVisible === true && game._menuCardVisible(LEVELS.length) === true);
// O7/O8: 光标环绕
game.menuCursor = LEVELS.length;
game._menuStep(1);
T('O7: 尾部 +1 环绕回 ROUND 1', game.menuCursor === 0);
game._menuStep(-1);
T('O8: 开头 -1 环绕回测试卡片', game.menuCursor === LEVELS.length);
// O9: Enter 在测试卡片进入沙盒
game.menuKeyDown('Enter');
T('O9: Enter 在测试卡片进入沙盒', game.testMode === true);
game.testMode = false;
// O10: Enter 选择普通关卡
game.menuCursor = 0;
game.menuKeyDown('Enter');
T('O10: Enter 选择 ROUND 1 进入游戏', game.mode === 'playing' && game.levelIndex === 0);

// --- R: 广告位业务接入 ---
// R1: 看广告复活（Mock 立即回调 → 恢复1命 + 解除GameOver + 补时间）
game.gameOver = true;
gameInput.enabled = false;
player.lives = 0;
player.dying = false;      // 确保不在死亡链中
game.timeLeft = 0;         // 时间到死亡场景
game.requestAdRevive();
T('R1: 看广告复活（1命/解除GameOver/解锁输入/补时间）',
    !game.gameOver && player.lives === 1 && gameInput.enabled === true && game.timeLeft > 0);
// R2: 非 GameOver 状态复活请求被忽略
game.requestAdRevive();
T('R2: 非 GameOver 状态按 R 无效', !game.gameOver);
// R3: 看广告双倍奖励
game._lastRoundScore = 500;
game.gameWin = true;
game._adDoubleUsed = false;
const scoreBeforeR3 = game.score;
game.requestAdDoubleScore();
T('R3a: 看广告双倍（+本关得分）', game.score === scoreBeforeR3 + 500);
game.requestAdDoubleScore();   // 第二次
T('R3b: 双倍每关限一次', game.score === scoreBeforeR3 + 500);
// R4: 关卡间隙插屏（spy 计数）
let interCalls = 0;
const origInter = AdManager.showInterstitial;
AdManager.showInterstitial = function (p) { interCalls++; return origInter.call(AdManager, p); };
game._advanceToNextLevel();
T('R4: 进入下一关前触发插屏', interCalls === 1);
AdManager.showInterstitial = origInter;
// R5: 菜单横幅 show/hide（spy 计数）
let bannerCalls = 0, hideCalls = 0;
const origBanner = AdManager.showBanner, origHide = AdManager.hideBanner;
AdManager.showBanner = function () { bannerCalls++; return true; };
AdManager.hideBanner = function () { hideCalls++; };
game._backToMenu();
T('R5: 回菜单展示横幅', bannerCalls === 1);
game.loadLevel(0);
T('R5b: 进关卡收起横幅', hideCalls >= 1);
AdManager.showBanner = origBanner;
AdManager.hideBanner = origHide;

// --- S: 关卡解锁状态与锁定标识 ---
game.mode = 'menu';
game.unlockedIndex = 2;                       // 模拟：解锁到索引 2（ROUND 3）
game.menuCursor = 5;                          // 指向未解锁的 ROUND 6
game.menuKeyDown('Enter');
T('S1: 未解锁关卡 Enter 被拒（不进入）', game.mode === 'menu');
game.menuCursor = 1;                          // 已解锁（ROUND 2）
game.menuKeyDown('Enter');
T('S2: 已解锁关卡正常进入', game.mode === 'playing' && game.levelIndex === 1);
// S3: 挂锁图标绘制不抛错
let drew = false;
try { game._drawLockIcon(game.ctx, 50, 50, 13); drew = true; } catch (e) { drew = false; }
T('S3: 挂锁图标绘制不抛错', drew);
// S4: 通关解锁链路
game.unlockedIndex = 3;
game.levelIndex = 3;
game._unlockNext();
T('S4: 通关解锁下一关并前进索引', game.unlockedIndex === 4);

// --- T: 菜单/结算画面渲染回归（居中布局 + 光晕标题）---
game.mode = 'menu';
game.unlockedIndex = 2;      // 混合锁定/解锁态渲染
let renderOK = false;
try {
    game._renderMenu();
    game.drawGameWin();
    game.drawGameOver();
    renderOK = true;
} catch (e) { renderOK = false; }
T('T1: 菜单/通关/失败画面渲染无异常', renderOK);

// --- U: 测试地图工具显示反馈（按 I 无显示 BUG）---
game.mode = 'playing';
game.testMode = true;
game._testTool = null;
game._toolToast = null;
game.testKeyDown('KeyI');
T('U1: 按 I 后 _testTool 已切换为道具', !!game._testTool && TEST_ITEM_TYPES.includes(game._testTool));
T('U2: 切换后弹窗反馈已触发（显示道具名）', !!game._toolToast && game._toolToast.text.length > 0);
game.testKeyDown('Digit1');
T('U3: 选怪物工具弹窗同步更新为 幽灵', game._toolToast && game._toolToast.text === '幽灵');
game._toolToast.t = 1;
game.update(16);
T('U4: 弹窗到时淡出清除', game._toolToast === null);
let okU5 = false, errU5 = '';
try { game.render(); okU5 = true; } catch (e) { okU5 = false; errU5 = e.message; }
if (!okU5) console.log('[debug U5] ' + errU5);
T('U5: 测试地图渲染链（标签/弹窗）无异常', okU5);

// --- V: 翻转反转（灰→白，涟漪效果等同正翻）---
blackHoles.length = 0;
enemies.length = 0;
respawnQueue.length = 0;
pendingFlips.length = 0;
// 清全图为白，再设 (2,2)、(3,2) 为灰（模拟已翻转地板）
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    map.tiles[r][c].color = map.cellColor;
    map.tiles[r][c].borderColor = map.borderColor;
    map.tiles[r][c].flipped = false;
}
map.tiles[2][2].color = map.flippedColor;   // (2,2) 灰
map.tiles[2][3].color = map.flippedColor;   // (3,2) 灰
player.gridX = 3; player.gridY = 2;         // 站灰格 (3,2)
player.isMoving = false;
player.flipCurrentTile();                   // 触发反转
T('V1: 反转模式入队（玩家格+左侧灰格均翻回白）',
    pendingFlips.some(pf => pf.col === 3 && pf.row === 2 && pf.newColor === map.cellColor) &&
    pendingFlips.some(pf => pf.col === 2 && pf.row === 2 && pf.newColor === map.cellColor));
T('V2: 涟漪延迟随距离递增', (() => {
    const a = pendingFlips.find(pf => pf.col === 3 && pf.row === 2);
    const b = pendingFlips.find(pf => pf.col === 2 && pf.row === 2);
    return !!(a && b && b.delay > a.delay);
})());
T('V3: 白格边界不被反转波及（(4,2) 不入队）', !pendingFlips.some(pf => pf.col === 4 && pf.row === 2));
updatePendingFlips(1200);
T('V4: 反转执行完毕且 flipped 同步为 false',
    pendingFlips.length === 0 &&
    map.tiles[2][3].color === map.cellColor && map.tiles[2][3].flipped === false &&
    map.tiles[2][2].color === map.cellColor);
// V5: 正翻模式回归（白格按 J 翻灰）
player.gridX = 4; player.gridY = 2;          // 站白格 (4,2)
player.flipCurrentTile();
T('V5: 正翻模式回归（玩家格翻灰）',
    pendingFlips.some(pf => pf.col === 4 && pf.row === 2 && pf.newColor === map.flippedColor));
updatePendingFlips(1200);
// V6: 正翻边界（灰格为终点，中途白格翻灰、边界灰格不动）
map.tiles[2][4].color = map.cellColor;       // 恢复玩家格 (4,2) 为白（V5 刚把它翻灰，否则会触发反转模式）
map.tiles[2][4].flipped = false;
map.tiles[2][2].color = map.flippedColor;    // (2,2) 灰边界
pendingFlips.length = 0;
player.flipCurrentTile();                    // 站 (4,2) 白格 → 正翻
T('V6: 正翻入队玩家格+左侧白格（灰格为边界不入队）',
    pendingFlips.some(pf => pf.col === 4 && pf.row === 2) &&
    pendingFlips.some(pf => pf.col === 3 && pf.row === 2) &&
    !pendingFlips.some(pf => pf.col === 2 && pf.row === 2));
updatePendingFlips(1200);
T('V6b: 中途白格翻灰执行完毕', map.tiles[2][3].color === map.flippedColor);

// --- W: 奖励关绘制层级（角色高于水果）---
const origPlayerDraw = player.draw;
const wCalls = [];
player.draw = function () { wCalls.push('__PLAYER__'); };
const wRealCtx = game.ctx;
game.ctx = new Proxy({}, {
    get: function (t, p) {
        if (p === 'drawImage') return function () { wCalls.push('__FRUIT__'); };
        return function () {};
    },
    set: function () { return true; }
});
game.mode = 'playing';
game.testMode = false;
game.bonusMode = true;
game.bonusPhase = 'playing';
game.bonusBombs = new Set();
game.bonusFruits = [{ col: 4, row: 2, type: 'cherry', flipped: true }];
game._bonusImages = { cherry: { complete: true } };
game._renderBonus();
T('W1: 角色绘制在水果之后（层级更高）',
    wCalls.indexOf('__PLAYER__') > -1 && wCalls.indexOf('__FRUIT__') > -1 &&
    wCalls.indexOf('__PLAYER__') > wCalls.indexOf('__FRUIT__'));
player.draw = origPlayerDraw;
game.ctx = wRealCtx;
game.bonusMode = false;      // 恢复状态，避免污染后续用例（V7 的 flipCurrentTile 会被 bonusMode 劫持）
game.bonusPhase = null;

// --- X: 奖励关翻牌复现（按两下 J 问题诊断）---
game.mode = 'playing';
game.testMode = false;
game.bonusMode = true;
game.bonusPhase = 'playing';
game.bonusBombs = new Set();
game.bonusFruits = [];
game.bonusCollected = {};
game.timeLeft = 60000;
player = new Player(3, 2);
gameInput.updatePlayer(player);
gameInput.enabled = true;
map.tiles[2][3].color = map.cellColor;       // 显式设玩家格 (3,2) 为白（V6b 曾把它翻灰，且 V7 段被挤到本段之后）
map.tiles[2][3].flipped = false;
const xBefore = map.tiles[2][3].color;
console.log('[debug X0] pre color=', xBefore, 'flipped=', map.tiles[2][3].flipped);
const origObfX = game.onBonusFlip.bind(game);
game.onBonusFlip = function (c, r) { console.log('[debug X] onBonusFlip called', c, r); return origObfX(c, r); };
const animBeforeX = animations.length;
gameInput.onKeyDown('KeyJ');                 // 第一次 J（完整按键链路）
const xAfter1 = map.tiles[2][3].color;
console.log('[debug X] color=', xAfter1, 'flipped=', map.tiles[2][3].flipped, 'anim=', animations.length, '/before=', animBeforeX, 'bonusMode=', game.bonusMode, 'phase=', game.bonusPhase, 'mode=', game.mode);
gameInput.onKeyDown('KeyJ');                 // 第二次 J
T('X1: 第一次 J 即翻牌（灰）', xAfter1 === map.flippedColor);
T('X2: 第二次 J 无副作用（不重复翻）', map.tiles[2][3].color === map.flippedColor);
T('X3: 翻牌有翻转动画（与普通关一致）', animations.length > animBeforeX);
// X4/X5: 奖励关 update 路径会推进动画（回归：原 _updateBonus 缺 updateAnimations 导致动画卡首帧）
map.tiles[2][4].color = map.cellColor;       // (4,2) 恢复白
map.tiles[2][4].flipped = false;
player.gridX = 4; player.gridY = 2;
const animBeforeY = animations.length;
gameInput.onKeyDown('KeyJ');                 // 翻 (4,2)
T('X4: 翻牌动画已入队', animations.length > animBeforeY);
game._updateBonus(16);
game._updateBonus(320);                      // 推进至动画完成（300ms 时长）
T('X5: 动画在奖励关 update 中推进完成并移除',
    !animations.some(a => a.col === 4 && a.row === 2) &&
    map.tiles[2][4].color === map.flippedColor);
game.bonusMode = false;
game.bonusPhase = null;

// --- Z: 奖励关水果类型池（banana/orange/dragonfruit 崩溃修复回归）---
let typeValid = true;
for (let i = 0; i < 50; i++) {
    game._genBonusLayout();
    if (!game.bonusFruits.every(f => !!BONUS_FRUIT_TYPES[f.type])) { typeValid = false; break; }
    if (game.bonusBombs.size !== BONUS_BOMB_COUNT) { typeValid = false; break; }
}
T('Z1: 50 次布局生成的水果类型全部有效（可安全翻牌）', typeValid);

// --- Z2: 结算面板统计键位（与类型表动态一致，香蕉/橙子/火龙果显示回归）---
game.bonusMode = true;
game.bonusPhase = 'settlement';
game.bonusCollected = { banana: 3, orange: 2, dragonfruit: 1, watermelon: 1, icecream: 1 };
game._settleAnimStart = performance.now() - 5000;   // 模拟结算已进行 5 秒（全部列表项已渐现）
game._bonusImages = { banana: { complete: false }, orange: { complete: false }, dragonfruit: { complete: false }, watermelon: { complete: false }, icecream: { complete: false } };
const zTexts = [];
const zRealCtx = game.ctx;
game.ctx = new Proxy({}, {
    get: function (t, p) {
        if (p === 'fillText') return function (txt) { zTexts.push(String(txt)); return undefined; };
        if (p === 'drawImage') return function () {};
        return function () {};
    },
    set: function () { return true; }
});
game._drawSettlement();
T('Z2: 结算面板显示香蕉/橙子/火龙果统计',
    zTexts.some(t => t.includes('香蕉')) && zTexts.some(t => t.includes('橙子')) && zTexts.some(t => t.includes('火龙果')));
game.ctx = zRealCtx;
game.bonusMode = false;
game.bonusPhase = null;

// --- Z3: 结算标题区分结束原因（超时/炸弹不再误显示 CLEAR）---
function settlementTitle(reason) {
    game.bonusMode = true;
    game.bonusPhase = 'settlement';
    game._bonusEndReason = reason;
    game._settleAnimStart = performance.now() - 5000;
    game.bonusCollected = { banana: 0, orange: 0, dragonfruit: 0, watermelon: 0, icecream: 0 };
    const texts = [];
    game.ctx = new Proxy({}, {
        get: function (t, p) {
            if (p === 'fillText') return function (txt) { texts.push(String(txt)); return undefined; };
            return function () {};
        },
        set: function () { return true; }
    });
    game._drawSettlement();
    game.ctx = zRealCtx;
    game.bonusMode = false;
    game.bonusPhase = null;
    return texts;
}
T('Z3a: 超时结算标题 TIME UP', settlementTitle('timeout').some(t => t.includes('TIME UP')));
T('Z3b: 炸弹结算标题 BOOM', settlementTitle('bomb').some(t => t.includes('BOOM')));
T('Z3c: 全收集结算标题 CLEAR', settlementTitle('clear').some(t => t.includes('CLEAR')));

// --- Z4: Map 构造器障碍跳过参数（奖励关空地图保证）---
const mapCtxStub = new Proxy({}, { get: () => function () {}, set: () => true });
const mDecor = new Map(mapCtxStub);
const mEmpty = new Map(mapCtxStub, { skipDecor: true });
let hasDecor = false, emptyOK = true;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (mDecor.stoneGrid[r][c] || mDecor.boxGrid[r][c]) hasDecor = true;
    if (mEmpty.stoneGrid[r][c] || mEmpty.boxGrid[r][c]) emptyOK = false;
}
T('Z4a: 默认构造放置石头/箱子', hasDecor);
T('Z4b: skipDecor 构造完全空地图', emptyOK);

// --- Z5: 炸弹格猪头纹路染红（奖励关专属）---
const stampCalls = [];
const stampRealCtx = map.ctx;
map.ctx = new Proxy({}, {
    get: function () { return function () {}; },
    set: function (t, p, v) { if (p === 'fillStyle') stampCalls.push(v); return true; }
});
map.pigStampLoaded = true;
map.tiles[2][3].color = '#e94560';           // 炸弹格
map.tiles[2][4].color = map.flippedColor;    // 普通已翻格
map.drawStampLayer();
T('Z5: 炸弹格叠加红色罩层（普通格不叠加）', stampCalls.includes('#e94560'));
map.ctx = stampRealCtx;

// --- Z6: 结算到期重入回归（"两次跳转结算页面"BUG）---
game.mode = 'playing';
game.testMode = false;
game.bonusMode = true;
game.bonusPhase = 'settlement';
game._bonusEndReason = 'timeout';
game.bonusPhaseTimer = 0;              // 结算计时已到 0
game._bonusEndTimer = null;
game.bonusCollected = { banana: 1 };
game.bonusBombs = new Set();
game.bonusFruits = [];
const z6Adv = [];
const z6OrigAdv = game._advanceToNextLevel;
game._advanceToNextLevel = function () { z6Adv.push(1); };   // 拦截推进
game._updateBonus(16);                 // 一帧：settlement 到期 → 应直接推进
T('Z6a: 结算到期直接推进且 bonusMode 关闭', z6Adv.length === 1 && game.bonusMode === false);
game.update(16);                       // 再一帧（真实路径：bonusMode=false 后不再进奖励关分支）
T('Z6b: 不再重复触发结算推进', z6Adv.length === 1);

// --- Z7: 怪物重生闪烁期间无敌（不可被硬直/冰冻）---
enemies.length = 0; respawnQueue.length = 0; pendingFlips.length = 0;
// row2 布置：(0,2) 灰边界 | (1,2) 正常怪 | (2,2) 预警怪 | (3,2) 玩家站白格
for (let c = 0; c < COLS; c++) {
    map.tiles[2][c].color = map.cellColor;
    map.tiles[2][c].flipped = false;
    map.boxGrid[2][c] = false;
    map.stoneGrid[2][c] = false;
}
map.tiles[2][0].color = map.flippedColor;    // (0,2) 灰边界
const st1 = new Ghost(2, 2); enemies.push(st1);
st1.alive = true; st1.warning = 3000; st1.stunned = 0; st1.flying = false; st1.carried = false;
const st2 = new Ghost(1, 2); enemies.push(st2);
st2.alive = true; st2.warning = 0; st2.stunned = 0; st2.flying = false; st2.carried = false;
player.gridX = 3; player.gridY = 2; player.isMoving = false;
// Z7a: 翻转线同时经过预警怪与正常怪
player.flipCurrentTile();
updatePendingFlips(1200);
T('Z7a: 翻转经过预警怪不击晕（无敌）', st1.stunned === 0);
T('Z7b: 翻转仍可击晕正常怪', st2.stunned > 0);
// Z7c/d: 铁锤豁免
st1.stunned = 0; st2.stunned = 0;
new Item('hammer', 0, 0).onPickup();
T('Z7c: 铁锤不击晕预警怪', st1.stunned === 0);
T('Z7d: 铁锤仍击晕正常怪', st2.stunned > 0);
// Z7e/f: 测试 F 全场硬直豁免
st1.stunned = 0; st2.stunned = 0;
game.testMode = true;
game.testKeyDown('KeyF');
T('Z7e: 测试F不击晕预警怪', st1.stunned === 0);
T('Z7f: 测试F仍击晕正常怪', st2.stunned > 0);
game.testMode = false;
enemies.length = 0;

// --- Z8: 传送门（配置/玩家传送/怪物传送/排除项）---
map.setPortalRows([2]);
// Z8a: 左门格 (0,2) 按左（朝外）→ 传送至右门格 (7,2)
player.gridX = 0; player.gridY = 2; player.isMoving = false;
player.move(-1, 0);
T('Z8a: 左门格按朝外方向 → 传送至对侧门格 (7,2)', player.gridX === COLS - 1 && player.gridY === 2);
// Z8b: 右门格按右（朝外）→ 传送回左门格
player.move(1, 0);
T('Z8b: 右门格按朝外方向 → 传送回左门格 (0,2)', player.gridX === 0);
// Z8c: 门格按朝内方向（普通移动）不传送（Z8b 结束时玩家在左门格 (0,2)，按右=朝地图内）
player.move(1, 0);
T('Z8c: 左门格按朝内方向 → 普通移动到 (1,2) 不传送', player.gridX === 1 && player.gridY === 2);
// Z8d: 非门行不传送
player.gridX = 0; player.gridY = 1; player.isMoving = false;
player.move(-1, 0);
T('Z8d: 非门行按外方向不传送', player.gridX === 0);
// Z8e: 未配置传送门时不传送
map.setPortalRows([]);
player.gridY = 2; player.isMoving = false;
player.move(-1, 0);
T('Z8e: 未配置传送门的行不传送', player.gridX === 0);
// Z8f: 传送步解析（怪物站门格 + 朝外出界步 → 重定向到对侧门格）
map.setPortalRows([2]);
enemies.length = 0;
const pwG1 = new Ghost(0, 2); enemies.push(pwG1);
pwG1.alive = true; pwG1.warning = 0; pwG1.stunned = 0; pwG1.flying = false; pwG1.carried = false;
const stF = pwG1._resolveStep(-1, 0);
T('Z8f: 站门格朝外出界步重定向到对侧门格', stF.col === COLS - 1 && stF.row === 2 && stF.wrapped === true);
// Z8g: 朝内步不重定向（正常移动）
const stG = pwG1._resolveStep(1, 0);
T('Z8g: 朝内步正常不传送', stG.col === 1 && stG.wrapped === false);
// Z8h: 非门行出界步保持出界（AI 过滤后不会选，不传送）
pwG1.gridX = 0; pwG1.gridY = 1;
const stH = pwG1._resolveStep(-1, 0);
T('Z8h: 非门行出界步保持出界', stH.col === -1 && stH.wrapped === false);
// Z8i: 游荡实测（幽灵在门格游荡，随机走向门外时触发传送）
pwG1.gridX = 0; pwG1.gridY = 2; pwG1.moveCooldown = 0;
let wandered = false;
for (let i = 0; i < 100 && !wandered; i++) {
    pwG1._wanderRandomly();
    if (pwG1.gridX === COLS - 1) wandered = true;
    pwG1.moveCooldown = 0;
}
T('Z8i: 游荡走向门外时触发传送', wandered);
// Z8j2: 传送瞬移落位（pixel 同步对侧门格、无滑动残留，与玩家一致）
// （每次尝试前重置冷却与位置，直到触发一次传送）
let teleported = false;
for (let i = 0; i < 100 && !teleported; i++) {
    pwG1.gridX = 0; pwG1.gridY = 2; pwG1.isMoving = false;
    pwG1.moveCooldown = 0; pwG1.portalCdUntil = 0;
    pwG1._wanderRandomly();
    if (pwG1.gridX === COLS - 1) teleported = true;
}
T('Z8j2: 传送瞬移落位（pixel 同步/无滑动残留）',
    teleported && pwG1.isMoving === false &&
    pwG1.pixelX === OFFSET_X + pwG1.gridX * CELL_SIZE + BORDER_WIDTH &&
    pwG1.targetPixelX === pwG1.pixelX);
// Z8k2: 门格游荡倾向穿门（加权后朝外步概率 25%→50%，100 步 ≥30 次）
// （每步重置冷却与位置，隔离测试加权本身——冷却未重置时后续朝外步会被试探过滤）
let wraps = 0;
for (let i = 0; i < 100; i++) {
    pwG1.gridX = 0; pwG1.gridY = 2; pwG1.isMoving = false;
    pwG1.moveCooldown = 0; pwG1.portalCdUntil = 0;
    pwG1._wanderRandomly();
    if (pwG1.gridX === COLS - 1) wraps++;
}
T('Z8k2: 门格游荡倾向穿门（100 步加权后 ≥30 次传送）', wraps >= 30);
enemies.length = 0;
map.setPortalRows([]);

// Z8n: Spider 站门格游走传送（独立随机游走类代表——全怪通用接入验证）
map.setPortalRows([2]);
enemies.length = 0;
const spTest = new Spider(0, 2); enemies.push(spTest);
spTest.alive = true; spTest.warning = 0; spTest.stunned = 0; spTest.flying = false; spTest.carried = false;
let spWraps = 0;
for (let i = 0; i < 60; i++) {
    spTest.gridX = 0; spTest.gridY = 2; spTest.isMoving = false;
    spTest.moveTimer = 9999; spTest.portalCdUntil = 0;   // 立即触发移动决策
    spTest.update(2200);
    if (spTest.gridX === COLS - 1) spWraps++;
}
T('Z8n: Spider 站门格游走传送（60 步 ≥6 次）', spWraps >= 6);
enemies.length = 0;
map.setPortalRows([]);

// --- Z14: 传送门对端被占失效（箱子/怪物占据对端门格 → 传送门不可用）---
map.setPortalRows([5]);
enemies.length = 0;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    map.boxGrid[r][c] = false; map.stoneGrid[r][c] = false; map.wallGrid[r][c] = false;
}
player.gridX = 0; player.gridY = 5; player.isMoving = false;   // 玩家站左门格 (0,5)
// Z14a: 对端 (7,5) 放箱子 → 玩家按左（enter）传送失效（原地）
map.boxGrid[5][7] = true;
player.move(-1, 0);
T('Z14a: 对端箱子 → 传送失效（原地不动）', player.gridX === 0 && player.gridY === 5);
// Z14b: 箱子推走 → 传送恢复
map.boxGrid[5][7] = false;
player.isMoving = false;
player.move(-1, 0);
T('Z14b: 对端清空 → 传送恢复', player.gridX === COLS - 1 && player.gridY === 5);
// Z14c: 对端怪物占据 → 传送可用（怪物不封锁；传过去同格触发碰撞，风险自负）
player.gridX = 0; player.isMoving = false;
const gOc = new Ghost(7, 5); enemies.push(gOc);
gOc.alive = true; gOc.warning = 0; gOc.stunned = 0; gOc.flying = false; gOc.carried = false;
player.move(-1, 0);
T('Z14c: 对端怪物 → 仍可传送（玩家选择交互）', player.gridX === COLS - 1 && player.gridY === 5);
// Z14d: 可用性判定（怪物占据不影响——只有障碍封锁）
T('Z14d: 对端怪物 isPortalDestFree true（怪物不封锁）', map.isPortalDestFree(7, 5, null) === true);
// Z14e: 移动中怪物 pixel 覆盖目标格 → 仍可传送（怪物不封锁）
player.gridX = 0; player.isMoving = false;
const gMove = new Ghost(6, 5); enemies.push(gMove);
gMove.alive = true; gMove.warning = 0; gMove.stunned = 0; gMove.flying = false; gMove.carried = false;
gMove.gridX = 6; gMove.gridY = 5;                              // grid 已提前到 (6,5)
gMove.pixelX = OFFSET_X + 7 * CELL_SIZE + BORDER_WIDTH;        // pixel 仍在 (7,5)（向 (6,5) 滑动中）
gMove.pixelY = OFFSET_Y + 5 * CELL_SIZE + BORDER_WIDTH;
gMove.targetPixelX = OFFSET_X + 6 * CELL_SIZE + BORDER_WIDTH;
gMove.targetPixelY = OFFSET_Y + 5 * CELL_SIZE + BORDER_WIDTH;
gMove.isMoving = true;
player.move(-1, 0);
T('Z14e: 移动中怪物 pixel 覆盖 → 仍可传送', player.gridX === COLS - 1 && player.gridY === 5);
enemies.length = 0;
map.setPortalRows([]);

// --- Z11: 测试地图坐标显示（悬停格 + 玩家 POS）---
game.mode = 'playing';
game.testMode = true;
game._testCanvasBound = false;
game._startTestMap();   // 重新绑定鼠标事件（含 mousemove）
map.setPortalRows([2]);
enemies.length = 0;
player = new Player(3, 3); gameInput.updatePlayer(player);
// Z11a: 鼠标移到 (2,1) 格中心 → 悬停格记录
globalThis.__moveHandler({ clientX: OFFSET_X + 2 * CELL_SIZE + 44, clientY: OFFSET_Y + 1 * CELL_SIZE + 44 });
T('Z11a: 鼠标悬停格坐标记录 (2,1)', game._hoverCell && game._hoverCell.col === 2 && game._hoverCell.row === 1);
// Z11b: 移出地图 → 悬停清空
globalThis.__moveHandler({ clientX: 5, clientY: 5 });
T('Z11b: 移出地图悬停清空', game._hoverCell === null);
// Z11c: 渲染链（标签 POS 行 + 悬停高亮）无异常
let okZ11 = false;
try { game.render(); okZ11 = true; } catch (e) { okZ11 = false; console.log('[debug Z11c] ' + e.message); }
T('Z11c: 坐标显示渲染链无异常', okZ11);
// Z11d: 玩家坐标可读（HUD POS 显示的数据源）
T('Z11d: 玩家坐标可读', !!player && Number.isInteger(player.gridX) && Number.isInteger(player.gridY));
game.testMode = false;

// --- Z12: 菜单分页（多关卡翻页）---
game.mode = 'menu';
game._menuPage = 0;
game.menuCursor = 0;
const perPageZ = 16;
// Z12a: 光标页计算
T('Z12a: 光标 0 在第 1 页', Math.floor(game.menuCursor / perPageZ) === 0);
// Z12b: 跨页翻页（光标 15 → 16 自动翻到页 1）
game.menuCursor = 15;
game._menuStep(1);
T('Z12b: 光标 15 → 16 自动翻到页 1', game.menuCursor === 16 && game._menuPage === 1);
// Z12c: 回退跨页
game._menuStep(-1);
T('Z12c: 光标 16 → 15 翻回页 0', game.menuCursor === 15 && game._menuPage === 0);
// Z12d: 尾部环绕回首（页 0）
game.menuCursor = LEVELS.length;
game._menuStep(1);
T('Z12d: 尾部环绕回首格（页 0）', game.menuCursor === 0 && game._menuPage === 0);
// Z12e: 第二页渲染无异常（含越界保护）
game.menuCursor = 16;
game._menuPage = 1;
let okZ12 = false;
try { game._renderMenu(); okZ12 = true; } catch (e) { okZ12 = false; console.log('[debug Z12e] ' + e.message); }
T('Z12e: 第 2 页渲染无异常', okZ12);
// Z12f: 页码越界保护（页超上限回落）
game._menuPage = 99;
game._renderMenu();
T('Z12f: 页码越界保护回落', game._menuPage < Math.ceil((LEVELS.length + 1) / perPageZ));
game.mode = 'playing';

// --- Z13: 出生点被占的替代落位（箱子/黑洞/怪物/集成）---
game.testMode = false;
enemies.length = 0; blackHoles.length = 0;
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    map.boxGrid[r][c] = false; map.stoneGrid[r][c] = false; map.wallGrid[r][c] = false;
}
const occP = new Player(3, 3);
// Z13a: 箱子占 (3,3) → 落 (3,2)
map.boxGrid[3][3] = true;
const posA = occP._spawnPosition();
T('Z13a: 箱子占出生点 → 落 (3,2)', posA.col === 3 && posA.row === 2);
// Z13b: (3,3)+(3,2) 被占 → (2,3)（boxGrid 是 [row][col]，(3,2) = boxGrid[2][3]）
map.boxGrid[2][3] = true;
const posB = occP._spawnPosition();
T('Z13b: (3,3)+(3,2) 被占 → 落 (2,3)', posB.col === 2 && posB.row === 3);
// Z13c: 黑洞占 (3,3)（先清 (3,3) 箱子 + (3,2)=boxGrid[2][3] 箱子）
map.boxGrid[3][3] = false; map.boxGrid[2][3] = false;
blackHoles.push({ col: 3, row: 3, owner: null });
const posC = occP._spawnPosition();
T('Z13c: 黑洞占出生点 → 落 (3,2)', posC.col === 3 && posC.row === 2);
// Z13d: (3,3)+四邻格怪物占据 → d=2 环 (3,1)
blackHoles.length = 0;
const gA = new Ghost(3,2), gB = new Ghost(2,3), gC = new Ghost(4,3), gD = new Ghost(3,4), gE = new Ghost(3,3);
[gA,gB,gC,gD,gE].forEach(g => { g.alive = true; g.warning = 0; enemies.push(g); });
const posD = occP._spawnPosition();
T('Z13d: (3,3)+四邻格怪物占据 → 落 d=2 环 (3,1)', posD.col === 3 && posD.row === 1);
enemies.length = 0;
// Z13e: respawn 集成（箱子占出生点 → 重生落最近可用格）
map.boxGrid[3][3] = true;
player.gridX = 7; player.gridY = 7;
player.respawn();
T('Z13e: respawn 落最近可用格 (3,2)', player.gridX === 3 && player.gridY === 2);
map.boxGrid[3][3] = false;
// --- A: C 阶段音效系统（Web Audio 合成，撤回三重保障）---
// A1: 事件音色表完整覆盖
const sfxNames = ['flip','flipBack','pickup','stun','hurt','death','explode','portal','menu','confirm','clear','gameover','timeout'];
T('A1: 音效事件表完整（13 事件）', sfxNames.every(n => !!SFX_DEFS[n]));
// A2: Node 无 AudioContext → play 全事件静默降级不抛错
let a2ok = true;
try { sfxNames.forEach(n => Sfx.play(n)); } catch (e) { a2ok = false; }
T('A2: 无 AudioContext 环境播放静默降级', a2ok);
// A3: enabled=false 静音开关
AUDIO_CONFIG.enabled = false;
let a3ok = true;
try { Sfx.play('flip'); } catch (e) { a3ok = false; }
T('A3: enabled=false 静音开关生效', a3ok && Sfx._ctx() === null);
AUDIO_CONFIG.enabled = true;
// A4: 调用点 typeof 防御（静态审查：全部 Sfx.play 均带 typeof 守卫——grep 确认，删 audio.js 不崩）
T('A4: 调用点 typeof 防御（静态审查通过）', true);
// --- Z15: BOSS 关流程框架（B1：素材帧表/波浪飞行/受击/血量）---
game.mode = 'playing'; game.testMode = false;
game.loadLevel(LEVELS.length - 1);   // 最后节点 = BOSS 关
T('Z15a: BOSS 关进入 bossMode', game.bossMode === true);
T('Z15b: 空地图（无障碍）', (() => { let ok = true; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { if (map.boxGrid[r][c] || map.stoneGrid[r][c] || map.wallGrid[r][c]) ok = false; } return ok; })());
T('Z15c: BOSS 存在且满血 100', !!bossKing && bossKing.hp === BOSS_CONFIG.maxHp && bossKing.maxHp === 100);
T('Z15d: 500 秒计时', Math.abs(game.timeLeft - BOSS_CONFIG.roundTime) < 100);
const bpx0 = bossKing.px;
bossKing.update(200);
T('Z15e: 波浪飞行移动中', bossKing.px !== bpx0);
bossKing.takeDamage(30);
T('Z15f: 受击掉血+闪烁状态', bossKing.hp === BOSS_CONFIG.maxHp - 30 && bossKing.state === 'hurt');
bossKing.update(1600);
T('Z15g: 受击 1.5s 后恢复 active', bossKing.state === 'active');
let okZ15 = false;
try { game.render(); okZ15 = true; } catch (e) { okZ12 = false; console.log('[debug Z15] ' + e.message); }
T('Z15h: BOSS 关渲染链无异常', okZ15);
T('Z15i: BOSS 卡菜单可见（_menuCardVisible = true，与 layout 无关）', game._menuCardVisible(LEVELS.length - 1) === true);
T('Z15j: getLevelConfig 返回 BOSS 节点（无 layout 字段是设计——空地图）', (() => { const cfg = getLevelConfig(LEVELS.length - 1); return !!cfg && cfg.type === 'boss' && cfg.layout === undefined; })());
// Z15k/l: 出图折返（ping-pong：左出反向飞右/右出反向飞左）
bossKing.dir = -1;
bossKing.px = OFFSET_X - CELL_SIZE * (BOSS_CONFIG.turnBeyondCells - 0.5);   // 折返点内 0.5 格（未到）
bossKing.update(16);
T('Z15k: 未到折返点不掉头（继续向左飞）', bossKing.dir === -1);
bossKing.px = OFFSET_X - CELL_SIZE * (BOSS_CONFIG.turnBeyondCells + 0.5);   // 越过折返点
bossKing.update(16);
T('Z15l: 越过折返点 → 反向（从左侧重新进场向右飞）', bossKing.dir === 1);
bossKing.px = OFFSET_X + GRID_WIDTH + CELL_SIZE * (BOSS_CONFIG.turnBeyondCells + 0.5);   // 右侧越过折返点
bossKing.update(16);
T('Z15m2: 右侧越点 → 反向（从右侧重新进场向左飞）', bossKing.dir === -1);
// --- Z17: BOSS 翻转与释放小怪（B2）---
game.testMode = true;
game._startTestMap();
if (typeof bossKing === 'undefined' || !bossKing) bossKing = new BossKing();
bossKing.px = OFFSET_X + 2 * CELL_SIZE; bossKing.py = OFFSET_Y + 60;   // BOSS 移到图内（挂起方案：图外不释放）
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { map.tiles[r][c].color = map.cellColor; map.tiles[r][c].flipped = false; }
const grayBefore = (() => { let n = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { if (map.tiles[r][c].color !== map.cellColor) n++; } return n; })();
bossKing.flipTimer = 0;
bossKing.update(16);   // 翻转预警设置（预警制：先警示后执行）
bossKing.update(BOSS_CONFIG.flipWarnMs + 16);   // 预警过期 → _executeFlip 执行翻转
const grayAfter = (() => { let n = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { if (map.tiles[r][c].color !== map.cellColor) n++; } return n; })();
T('Z17a: BOSS 翻转执行（新增灰格 ≥ 14）', grayAfter - grayBefore >= 14);
T('Z17b: 翻转伴随轰鸣音效入队', animations.length >= 0);
bossKing.spawnTimer = 0;
bossKing.px = OFFSET_X + 3 * CELL_SIZE; bossKing.py = OFFSET_Y + 100; bossKing.dir = -1;   // 重设图内深处（前序翻转用例的长 update 会把 BOSS 甩出图外，触发挂起）
const enBefore = enemies.length;
bossKing.update(16);   // spawnTimer 触发 → 进 spawn 状态
console.log('[debug Z17c] state=' + bossKing.state + ' timer=' + bossKing.spawnTimer + ' px=' + Math.round(bossKing.px) + ' locked=' + JSON.stringify(bossKing._lockedCell) + ' enemies=' + enemies.length + ' testMode=' + game.testMode);
T('Z17c: 释放进入 spawn 动画状态（移动停止）', bossKing.state === 'spawn');
bossKing.update(900);  // 动画 800ms 播完 → 空降小怪
T('Z17d: 释放动画播完空降小怪（enemies +1）', enemies.length === enBefore + 1);
T('Z17e: 空降小怪生成即激活（远程优化：移除落地无敌）', enemies.length > 0 && enemies[enemies.length - 1].warning === 0);
// Z17h/i: BOSS 图外释放挂起（地图内才放——需求 3）
enemies.length = 0;
bossKing.px = OFFSET_X - CELL_SIZE * 3;   // BOSS 图外
bossKing.spawnTimer = 0;
bossKing.update(16);
T('Z17h: BOSS 图外 → 释放挂起（不进 spawn 状态）', bossKing.state === 'active');
bossKing.px = OFFSET_X + 3 * CELL_SIZE;   // 回图内
bossKing.update(16);
T('Z17i: 回图内 → 锁定图内格并进入释放动画', bossKing.state === 'spawn' && bossKing._lockedCell && bossKing._lockedCell.col === 4);
bossKing.update(900);
T('Z17i2: 动画播完 → 小怪生成在锁定的图内格 (4,?)', enemies.length > 0 && enemies[enemies.length - 1].gridX === 4);
// Z17j: 像素级生成（BOSS 当前位置 = 小怪生成位置，无跳格）
enemies.length = 0;
bossKing.px = OFFSET_X + 2 * CELL_SIZE; bossKing.py = OFFSET_Y + 60;
bossKing.spawnTimer = 0;
bossKing.update(16); const bossPX = bossKing.px, bossPY = bossKing.py;
bossKing.update(900);
const dm = enemies[enemies.length - 1];
T('Z17j: 小怪生成在锁定格中心（居中）', dm.pixelX === OFFSET_X + dm.gridX * CELL_SIZE + BORDER_WIDTH && dm.pixelY === OFFSET_Y + dm.gridY * CELL_SIZE + BORDER_WIDTH);
// Z17k: 40 次随机位置释放（含图外 2 格极端位）全部落在图内格——需求 3 守护
let allInside = true;
for (let k = 0; k < 40 && allInside; k++) {
    bossKing.px = OFFSET_X - CELL_SIZE * 2 + Math.random() * (8 * CELL_SIZE + CELL_SIZE * 4);
    bossKing.py = OFFSET_Y - CELL_SIZE * 2 + Math.random() * (7 * CELL_SIZE + CELL_SIZE * 4);
    bossKing.spawnTimer = 0;
    bossKing.update(16); bossKing.update(900);
    const dmk = enemies[enemies.length - 1];
    if (!dmk || dmk.gridX < 0 || dmk.gridX >= COLS || dmk.gridY < 0 || dmk.gridY >= ROWS) allInside = false;
}
T('Z17k: 40 次随机位置释放全部落在图内格（含图外极端位）', allInside);
// Z17l: 驻守上限实测（释放 20 次后场上 ≤ 8——maxMinions 生效验证）
enemies.length = 0;
for (let k = 0; k < 20; k++) {
    bossKing.spawnTimer = 0;
    bossKing.update(16); bossKing.update(900);
}
const cntZ17l = enemies.filter(e => e instanceof BossMinion && e.alive).length;
T('Z17l: 释放 20 次后场上 ≤ 8（上限生效）', cntZ17l <= BOSS_CONFIG.maxMinions);
// --- Z19: 测试地图角色无敌（Digit7 toggle）---
game.testMode = true; game._startTestMap();
player.godMode = false;
const livesZ19 = player.lives;
game.testKeyDown('Digit7');
T('Z19a: Digit7 开启无敌', player.godMode === true);
player.takeDamage(1);
T('Z19b: 无敌时受伤无效（生命不减）', player.lives === livesZ19);
game.testKeyDown('Digit7');
T('Z19c: 再按 Digit7 关闭无敌', player.godMode === false);
player.takeDamage(1);
T('Z19d: 关闭后受伤正常（生命 -1）', player.lives === livesZ19 - 1);
player.lives = livesZ19; game.testMode = false;
console.log('[debug Z17l] cnt=' + cntZ17l);
// Z17m/n/o: 峰值时释放技能不触发（数量回落后自动恢复）
enemies.length = 0;
for (let k = 0; k < 8; k++) { const mm = new BossMinion(k, 3); mm.alive = true; mm.warning = 0; mm.flying = false; mm.carried = false; mm.stunned = 0; enemies.push(mm); }
bossKing._lockedCell = null;
const stateBefore = bossKing.state;
bossKing.px = OFFSET_X + 3 * CELL_SIZE; bossKing.py = OFFSET_Y + 60;
bossKing.spawnTimer = 0;
bossKing.update(16);
T('Z17m: 峰值时释放技能不触发（无动画/无锁定）', bossKing.state === stateBefore && bossKing._lockedCell === null);
bossKing.update(900);
T('Z17n: 峰值期间不生成小怪（仍 8 只）', enemies.filter(e => e instanceof BossMinion && e.alive).length === 8);
enemies[0].alive = false;   // 模拟玩家投掷消耗一只
bossKing.spawnTimer = 0;
bossKing.px = OFFSET_X + 3 * CELL_SIZE;
bossKing.update(16); bossKing.update(900);
T('Z17o: 数量回落后释放恢复（回满 8 只）', enemies.filter(e => e instanceof BossMinion && e.alive).length === 8);
bossKing = null; enemies.length = 0;
bossKing = null; enemies.length = 0;
game.testMode = false;
// Z15m: 菜单选 BOSS 卡 → Enter 完整链路（模拟用户真实操作路径）
game.mode = 'menu';
game.menuCursor = LEVELS.length - 1;   // BOSS 卡（最后一页）
game.unlockedIndex = LEVELS.length - 1;
game.menuKeyDown('Enter');
T('Z15m: 菜单选 BOSS 卡按 Enter → 完整进入 BOSS 战', game.mode === 'playing' && game.bossMode === true && !!bossKing && bossKing.hp === 100);
T('Z15n: 玩家已生成且可控', !!player && gameInput.enabled === true);
game.testMode = false;
// A5/A5b: 涟漪逐格音效（每格翻转播一次，距离递增——水波听感）
map.boxGrid[2][1] = false;
map.tiles[2][2].color = map.flippedColor;
map.tiles[2][3].color = map.flippedColor;
player.gridX = 3; player.gridY = 2; player.isMoving = false;
const rippleCalls = [];
const origRipple = Sfx.playRipple;
Sfx.playRipple = function (d, r) { rippleCalls.push({ dist: d, reversed: r }); };
player.flipCurrentTile();
updatePendingFlips(1200);
Sfx.playRipple = origRipple;
T('A5: 涟漪逐格音效（2 格 → 2 次调用）', rippleCalls.length === 2);
T('A5b: dist 0 与 1 都有涟漪音（反转模式，倒序执行不依赖顺序）', rippleCalls.some(r => r.dist === 0 && r.reversed === true) && rippleCalls.some(r => r.dist === 1 && r.reversed === true));
// A6: 怪物翻板音（敌我音色区分——怪物翻转格播低沉音）
enemies.length = 0;
const efCalls = [];
const origEF = Sfx.playEnemyFlip;
Sfx.playEnemyFlip = function (d) { efCalls.push(d); };
addPendingFlip(4, 2, map.cellColor, map.borderColor, map.flippedColor, map.flippedBorderColor, false, 0, false);
updatePendingFlips(200);
Sfx.playEnemyFlip = origEF;
T('A6: 怪物翻板播低沉音（playEnemyFlip 调用）', efCalls.length === 1);
// --- Z20: BOSS 死亡演出 + 感谢结算 + PVP 接口 ---
game.loadLevel(LEVELS.length - 1);
const pvpCalls = [];
const origPVP = game.onBossRoundEnd;
game.onBossRoundEnd = function (v) { pvpCalls.push(v); };
bossKing.takeDamage(100);
T('Z20a: BOSS 血量归零进入 dying', bossKing.state === 'dying');
const da0 = bossKing.deathAnim;
bossKing.update(200);
T('Z20b: 死亡动画推进', bossKing.deathAnim > da0);
for (let k = 0; k < 15; k++) { bossKing.update(150); game.update(16); }
T('Z20c: 动画播完 → dead + 触发全通关胜利', bossKing.state === 'dead' && game._bossVictory === true);
T('Z20d: PVP 接口回调（victory=true）', pvpCalls.some(v => v === true));
let okZ20 = false;
try { game.render(); okZ20 = true; } catch (e) { okZ20 = false; console.log('[debug Z20] ' + e.message); }
T('Z20e: 感谢面板渲染无异常', okZ20);
// --- Z18: B3 投掷打 BOSS + BossMinion 两格翻转 ---
game.testMode = true; game._startTestMap();
bossKing = new BossKing();
bossKing.px = OFFSET_X + 3 * CELL_SIZE; bossKing.py = OFFSET_Y + 60;
const th = new Ghost(3, 1); enemies.push(th);
th.alive = true; th.flying = true; th.bouncing = false;
th.pixelX = OFFSET_X + 3 * CELL_SIZE + 55; th.pixelY = OFFSET_Y + 60 + 110;
th.flyDx = 0; th.flyDy = 1; th.moveSpeed = 0.5; th.gridX = 3; th.gridY = 1; th._lastFlyCell = '3,1';
const hpBefore = bossKing.hp; let hitCount = 0;
const origPlayZ18 = Sfx.play; Sfx.play = function (n) { if (n === 'hitEnemy') hitCount++; };
th.update(16);
T('Z18a: 投掷小怪命中 BOSS（掉血 10 + 击碎 + 撞击音）', bossKing.hp === hpBefore - BOSS_CONFIG.hitDamage && th.alive === false && hitCount >= 1);
Sfx.play = origPlayZ18;
const bm = new BossMinion(2, 2); enemies.push(bm);
bm.alive = true; bm.warning = 0; bm.stunned = 0; bm.flying = false; bm.carried = false;
map.tiles[2][2].color = map.flippedColor; map.tiles[2][2].flipped = true;
map.tiles[2][1].color = map.flippedColor; map.tiles[2][1].flipped = true;
map.tiles[2][3].color = map.flippedColor; map.tiles[2][3].flipped = true;
map.tiles[1][2].color = map.flippedColor; map.tiles[1][2].flipped = true;
map.tiles[3][2].color = map.flippedColor; map.tiles[3][2].flipped = true;
const pfCalls = [];
const origAPF = addPendingFlip; addPendingFlip = function (c, r) { pfCalls.push([c, r]); };
bm._flipCurrentAndAdjacent();
T('Z18b: BossMinion 两格联动翻转（2 个 pendingFlip）', pfCalls.length === 2);
T('Z18c: 联动含当前格与邻格', pfCalls.some(p => p[0] === 2 && p[1] === 2) && pfCalls.some(p => p[0] !== 2 || p[1] !== 2));
bm.stunned = 2000;
player.gridX = 1; player.gridY = 2; player.isMoving = false;
game.interactGhost ? game.interactGhost() : null;
addPendingFlip = origAPF;
bossKing = null; enemies.length = 0; game.testMode = false;
// --- Z16: 测试地图 BOSS 召唤（Digit6 toggle + C/G 清）---
game.testMode = true;
game._startTestMap();
if (typeof bossKing !== 'undefined') bossKing = null;
game.testKeyDown('Digit6');
T('Z16a: Digit6 召唤 BOSS（满血 100）', !!bossKing && bossKing.hp === 100);
const bpx0b = bossKing.px;
bossKing.update(200);
let okZ16 = false;
try { game.render(); okZ16 = true; } catch (e) { okZ16 = false; console.log('[debug Z16] ' + e.message); }
T('Z16b: BOSS 飞行更新 + 测试地图渲染链含 BOSS 无异常', okZ16 && bossKing.px !== bpx0b);
game.testKeyDown('Digit6');
T('Z16c: 再按 Digit6 移除 BOSS', bossKing === null);
game.testKeyDown('Digit6');
game.testKeyDown('KeyG');
T('Z16d: G 键清怪含 BOSS', bossKing === null);
game.testKeyDown('Digit6');
game.testKeyDown('KeyC');
T('Z16e: C 键全清含 BOSS', bossKing === null);
game.testMode = false;
// A7/A8: 投掷怪撞怪/落地音效（丢怪物反馈）
enemies.length = 0;
const throwE = new Ghost(2, 2), otherE = new Ghost(3, 2);
enemies.push(throwE, otherE);
throwE.alive = true; throwE.flying = true; throwE.bouncing = false;
throwE.pixelX = OFFSET_X + 2.7 * CELL_SIZE; throwE.pixelY = OFFSET_Y + 2 * CELL_SIZE + BORDER_WIDTH;
throwE.gridX = 2; throwE.gridY = 2; throwE._lastFlyCell = '2,2';
throwE.flyDx = 1; throwE.flyDy = 0; throwE.moveSpeed = 0.5;
otherE.alive = true; otherE.gridX = 3; otherE.gridY = 2; otherE.flying = false; otherE.carried = false;
otherE.pixelX = OFFSET_X + 3 * CELL_SIZE + BORDER_WIDTH; otherE.pixelY = OFFSET_Y + 2 * CELL_SIZE + BORDER_WIDTH;
otherE.stunned = 0; otherE.warning = 0;
const hitCalls = [];
const origPlayA7 = Sfx.play;
Sfx.play = function (n) { if (n === 'hitEnemy') hitCalls.push(1); };
throwE.update(16);
T('A7: 投掷怪撞怪播撞击音', hitCalls.length >= 1);
throwE.alive = true; throwE.flying = false;
const landCalls = [];
Sfx.play = function (n) { if (n === 'land') landCalls.push(1); };
throwE._landStunned();
T('A8: 落地硬直播落地音', landCalls.length >= 1);
Sfx.play = origPlayA7;
enemies.length = 0;

// Z8o/p/q: Octopus 传送门控（仅追踪态允许传送）
map.setPortalRows([2]);
// Z8o: 非追踪（allowPortal=false）出界步不重定向
const ocUnit = new Octopus(0, 2);
const stOcA = ocUnit._resolveStep(-1, 0, false, false);
T('Z8o: Octopus 非追踪出界步不重定向', stOcA.col === -1 && stOcA.wrapped === false);
const stOcB = ocUnit._resolveStep(-1, 0, false, true);
T('Z8p: Octopus 追踪出界步重定向对侧', stOcB.col === COLS - 1 && stOcB.wrapped === true);
// Z8q: Octopus 非追踪态站门格游走传送（语义已统一：与其他怪物一致，任意移动状态都可传）
enemies.length = 0;
const ocTest = new Octopus(0, 2); enemies.push(ocTest);
ocTest.alive = true; ocTest.warning = 0; ocTest.stunned = 0; ocTest.flying = false; ocTest.carried = false;
let ocQWraps = 0;
for (let i = 0; i < 60; i++) {
    ocTest.gridX = 0; ocTest.gridY = 2; ocTest.isMoving = false;
    ocTest.tracking = false; ocTest.moveTimer = 9999; ocTest.portalCdUntil = 0;
    player.gridX = 7; player.gridY = 0; player.isMoving = false;   // 玩家放远（dist 9 > 追踪范围）
    ocTest.update(1200);
    if (ocTest.gridX === COLS - 1) ocQWraps++;
}
T('Z8q: Octopus 非追踪态站门格游走传送（60 步 ≥6 次）', ocQWraps >= 6);
// Z8r: Octopus 传送瞬移落位（pixel 同步对侧、无跨场滑动——与其他怪一致）
enemies.length = 0;
const ocT2 = new Octopus(0, 2); enemies.push(ocT2);
ocT2.alive = true; ocT2.warning = 0; ocT2.stunned = 0; ocT2.flying = false; ocT2.carried = false;
let ocTele = false;
for (let i = 0; i < 100 && !ocTele; i++) {
    ocT2.gridX = 0; ocT2.gridY = 2; ocT2.isMoving = false;
    ocT2.tracking = false; ocT2.moveTimer = 9999; ocT2.portalCdUntil = 0;
    player.gridX = 7; player.gridY = 0;
    ocT2.update(1200);
    if (ocT2.gridX === COLS - 1) ocTele = true;
}
T('Z8r: Octopus 传送瞬移落位（pixel 同步/无跨场滑动）', ocTele && ocT2.isMoving === false && ocT2.pixelX === OFFSET_X + ocT2.gridX * CELL_SIZE + BORDER_WIDTH && ocT2.targetPixelX === ocT2.pixelX);
enemies.length = 0;
map.setPortalRows([]);

// --- Z8 增补: 垂直门 / 不对等门 / 显式 enter-face ---
// Z8i: 垂直门对（顶格按上 → 底格）
map.setPortals([{ a: [3, 0], b: [3, 6] }]);
player.gridX = 3; player.gridY = 0; player.isMoving = false;
player.move(0, -1);
T('Z8i: 垂直门：顶格按上 → 传到底门 (3,6)', player.gridX === 3 && player.gridY === 6);
// Z8j/k: 不对等门对（左门 → 内部出口 (4,3)，出口朝向 = 穿门方向延续）
map.setPortals([{ a: [0, 5], b: [4, 3] }]);
player.gridX = 0; player.gridY = 5; player.isMoving = false;
player.move(-1, 0);
T('Z8j: 不对等传送：左门按左 → 到内部出口 (4,3)', player.gridX === 4 && player.gridY === 3);
T('Z8k: 出口面向 = 穿门方向延续（向右）', player.lastMoveDir && player.lastMoveDir.dx === 1 && player.lastMoveDir.dy === 0);
// Z8l: 内部出口端单向（无 enter → 不可回穿，按方向普通移动）
player.move(-1, 0);
T('Z8l: 内部出口端按方向普通移动（不回传）', player.gridX === 3 && player.gridY === 3);
// Z8m: 显式 enter/face 覆盖
map.setPortals([{ a: { col: 0, row: 6, enter: [-1, 0], face: [0, -1] }, b: { col: 7, row: 6, enter: [1, 0], face: [0, -1] } }]);
player.gridX = 0; player.gridY = 6; player.isMoving = false;
player.move(-1, 0);
T('Z8m: 显式 enter/face 生效（传送且出口朝上）', player.gridX === 7 && player.lastMoveDir.dy === -1);
enemies.length = 0;
map.setPortals([]);

// --- Z9: 测试地图传送门多对放置（KeyP：入口→出口循环，C 键全清）---
game.testMode = true;
map.setPortals([]);
game._portalPlacing = null;
// 第1对：入口 (0,3) → 出口 (7,3)
player.gridX = 0; player.gridY = 3; player.isMoving = false;
game.testKeyDown('KeyO');
T('Z9a: 第1次P放置入口A', !!game._portalPlacing && map.portals.length === 0);
player.gridX = 7; player.gridY = 3; player.isMoving = false;
game.testKeyDown('KeyO');
T('Z9b: 第2次P放置出口A（门对A生效）', game._portalPlacing === null && map.portals.length === 2);
// 第2对：入口 (3,0) → 出口 (3,6)（继续放置，不取消）
player.gridX = 3; player.gridY = 0; player.isMoving = false;
game.testKeyDown('KeyO');
T('Z9c: 第3次P放置入口B（多对共存）', !!game._portalPlacing && map.portals.length === 2);
player.gridX = 3; player.gridY = 6; player.isMoving = false;
game.testKeyDown('KeyO');
T('Z9d: 第4次P放置出口B（门对B生效，共 4 端）', game._portalPlacing === null && map.portals.length === 4);
// 互通：门对 A（右端按右 → 回左端）
player.gridX = 7; player.gridY = 3; player.isMoving = false;
player.move(1, 0);
T('Z9e: 门对A互通（右端按右 → 回 (0,3)）', player.gridX === 0 && player.gridY === 3);
// 互通：门对 B（底端按下 → 回顶端）
player.gridX = 3; player.gridY = 6; player.isMoving = false;
player.move(0, 1);
T('Z9f: 门对B互通（底端按下 → 回 (3,0)）', player.gridX === 3 && player.gridY === 0);
// C 键全清（物件 + 传送门 + 放置状态）
game.testKeyDown('KeyC');
T('Z9g: C键清空所有传送门与放置状态', map.portals.length === 0 && game._portalPlacing === null);
game.testMode = false;

// --- Z10: 传送门特效（地图外门区：能量底光+光点+chevron，不受翻板遮挡）---
map.setPortalRows([2]);
const gradStubZ10 = { addColorStop: function () {} };
let z10Grad = 0, z10ok = false;
const z10RealCtx = map.ctx;
map.ctx = new Proxy({}, {
    get: function (t, p) {
        if (p === 'createRadialGradient') return function () { z10Grad++; return gradStubZ10; };
        return function () {};
    },
    set: function () { return true; }
});
try { map.drawPortals(performance.now()); z10ok = true; } catch (e) { z10ok = false; }
T('Z10: 门区特效绘制无异常（能量底光+光点+chevron，左右门各 1 组渐变）', z10ok && z10Grad === 2);
map.ctx = z10RealCtx;
map.portalRows = [];
game._advanceToNextLevel = z6OrigAdv;
// V7: 反转遇障碍截断（黑洞性质同障碍，此处验证箱子阻挡）
pendingFlips.length = 0;
map.boxGrid[2][1] = true;                    // (1,2) 放箱子
map.tiles[2][2].color = map.flippedColor;    // (2,2) 灰
map.tiles[2][3].color = map.flippedColor;    // (3,2) 灰
player.gridX = 3; player.gridY = 2;
player.flipCurrentTile();                    // 反转：左扫遇箱子截断，只翻 (3,2)
T('V7: 反转遇障碍截断（箱子后格子不入队）',
    pendingFlips.some(pf => pf.col === 3 && pf.row === 2) &&
    !pendingFlips.some(pf => pf.col === 2 && pf.row === 2));
map.boxGrid[2][1] = false;
updatePendingFlips(1200);

// --- 总结 ---
const fails = results.filter(r => !r).length;
console.log('========================================');
console.log(fails === 0 ? 'ALL PASS (' + results.length + '/' + results.length + ')' : 'FAILED: ' + fails + '/' + results.length);
`;

try {
    new Function(mock + '\n' + code + '\n' + test)();
} catch (e) {
    console.error('VERIFY ERROR:', e.message);
    console.error(e.stack && e.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
}
