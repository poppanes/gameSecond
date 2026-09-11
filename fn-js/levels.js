// ============================================
// 关卡配置表（前10回合 demo + 2个特殊关卡）
// ============================================
// 决策点：
//   1. 难度曲线 = 混合（台阶式：1-5回合为台阶1，6-10回合为台阶2）
//   2. 怪物配置 = 按下方 LEVELS 精确指定
//   3. 地图尺寸不变（8×7）
//   4. 关卡选择菜单 + localStorage 持久化解锁进度
//   5. 无限重试本关，通关当前关卡才解锁下一关卡
//
// 节点顺序（12 个）：第1~4回合 → 特殊关卡-1 → 第5~8回合 → 特殊关卡-2 → 第9~10回合
// 特殊关卡（type:'bonus'）复用现有奖励关卡系统。

// ============================================
// 测试开关：true = 解锁全部关卡（便于测试地图配置）
// 上线前请改回 false
// ============================================
const UNLOCK_ALL = true;

// 墙（空气墙）是否可见：true = 半透明可视化（便于编辑调试），false = 完全不可见（真空气墙）
const WALL_VISIBLE = true;

// 怪物中文名（菜单/日志展示用）
const ENEMY_NAMES = {
    Ghost:    '幽灵',
    Spider:   '蜘蛛',
    Snowman:  '雪人',
    Octopus:  '章鱼',
    Owl:      '猫头鹰',
};

// 难度台阶对应的时间限制（毫秒）
const TIER_TIME = {
    1: 150000,   // 台阶1（1-5回合）
    2: 120000,   // 台阶2（6-10回合，时间更紧）
};

// ============================================
// 关卡列表
// ============================================
// 每关布局（石头/箱子/墙/黑洞）支持两种写法，二者任选其一，优先级：坐标数组 > 字符网格。
//   ① 坐标数组：stones: [[列,行], ...], boxes: [[列,行], ...], walls: [[列,行], ...], holes: [[列,行], ...]
//      例：stones: [[4,1],[3,4]], boxes: [[2,2],[6,2]], walls: [[3,3],[4,3]], holes: [[5,4]]
//   ② 字符网格：layout 为 7 行 × 8 列字符串，'.'=空地  'S'=石头  'B'=箱子  '#'=墙(空气墙)  'H'=黑洞
//      例：layout: ["........", "....S...", "...#.#H.", ...]
// 网格坐标系：col 取 0~7（列），row 取 0~6（行）。
// 禁区（自动跳过，无需避开）：四角出生点(0,0)(7,0)(0,6)(7,6)及相邻格、玩家起点(3,2)。
// 墙 = 空气墙：不可通行、不可翻转、豁免通关；WALL_VISIBLE 控制是否可见（见文件顶部）。
// 黑洞 = 地形黑洞：不可通行、不可翻转、豁免通关，怪物/玩家/箱子都无法进入。
// 特殊关卡（type:'bonus'）不使用布局，走 initEmpty 全白地板。
// ============================================
const LEVELS = [
    { id: 1,  name: '第1回合',  type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        "........",
        "........",
        "....S...",
        "...S....",
        "........",
        "........",
      ] },
    { id: 2,  name: '第2回合',  type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        ".S....S.",
        "........",
        "........",
        "........",
        ".S....S.",
        "........",
      ] },
    { id: 3,  name: '第3回合',  type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        "........",
        "....SSS.",
        "........",
        "........",
        "..SSS...",
        "........",
      ] },
    { id: 4,  name: '第4回合',  type: 'normal', tier: 1, enemies: { Ghost: 2, Spider: 1 },
      layout: [
        "........",
        "..S..B..",
        ".....SB.",
        "........",
        ".BS.....",
        "..B..S..",
        "........",
      ] },
    { id: 5,  name: '特殊关卡-1', type: 'bonus', tier: 1 },
    { id: 6,  name: '第5回合',  type: 'normal', tier: 1, enemies: { Ghost: 2, Spider: 1 },
      layout: [
        "........",
        "......S.",
        "..S...B.",
        "..S...S.",
        "BSS.....",
        "........",
        "........",
      ] },
    { id: 7,  name: '第6回合',  type: 'normal', tier: 2, enemies: { Ghost: 1, Spider: 1, Snowman: 1 },
      layout: [
        "........",
        "........",
        ".SS.SBS.",
        "..S.S.B.",
        "......B.",
        "....BSS.",
        "........",
      ] },
    { id: 8,  name: '第7回合',  type: 'normal', tier: 2, enemies: { Owl: 1, Spider: 1, Snowman: 1 },
      layout: [
        "........",
        "........",
        "....B...",
        "#.###B..",
        "....#...",
        "....#...",
        "....#...",
      ] },
    { id: 9,  name: '第8回合',  type: 'normal', tier: 2, enemies: { Octopus: 1, Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "...SB...",
        "..B..B..",
        "..S..S..",
        "..B..B..",
        "...BS...",
        "........",
      ] },
    { id: 10, name: '特殊关卡-2', type: 'bonus', tier: 2 },
    { id: 11, name: '第9回合',  type: 'normal', tier: 2, enemies: { Octopus: 1, Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "....HHHH",
        "....H...",
        "....B...",
        "....H...",
        "....HHHH",
        "........",
      ] },
    { id: 12, name: '第10回合', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "...SS...",
        "........",
        "H.HHHH.H",
        "....S...",
        "....S...",
        "...S....",
      ] },
];

// 获取关卡配置（含自动补齐时间）
function getLevelConfig(index) {
    const cfg = LEVELS[index];
    if (!cfg) return null;
    return cfg;
}

// 获取关卡时间（毫秒），正常关卡按台阶取，特殊关卡返回 null
function getLevelTime(cfg) {
    if (cfg.type === 'bonus') return null;
    return TIER_TIME[cfg.tier] || TIER_TIME[1];
}

// 解析关卡布局 → { stones:[[列,行],...], boxes:[[列,行],...], walls:[[列,行],...], holes:[[列,行],...] }，无布局返回 null
// 优先级：坐标数组（stones/boxes/walls/holes）> 字符网格（layout）
function parseLevelLayout(cfg) {
    if (!cfg) return null;
    // ① 坐标数组形式
    if (Array.isArray(cfg.stones) || Array.isArray(cfg.boxes) || Array.isArray(cfg.walls) || Array.isArray(cfg.holes)) {
        return {
            stones: Array.isArray(cfg.stones) ? cfg.stones : [],
            boxes:  Array.isArray(cfg.boxes)  ? cfg.boxes  : [],
            walls:  Array.isArray(cfg.walls)  ? cfg.walls  : [],
            holes:  Array.isArray(cfg.holes)  ? cfg.holes  : [],
        };
    }
    // ② 字符网格形式
    if (Array.isArray(cfg.layout)) {
        const stones = [], boxes = [], walls = [], holes = [];
        cfg.layout.forEach((rowStr, r) => {
            for (let c = 0; c < rowStr.length; c++) {
                const ch = rowStr[c];
                if (ch === 'S' || ch === 's') stones.push([c, r]);
                else if (ch === 'B' || ch === 'b') boxes.push([c, r]);
                else if (ch === '#' || ch === 'W' || ch === 'w') walls.push([c, r]);
                else if (ch === 'H' || ch === 'h' || ch === 'O' || ch === 'o') holes.push([c, r]);
            }
        });
        return { stones, boxes, walls, holes };
    }
    return null;
}

// ============================================
// 关卡进度持久化（localStorage）
// ============================================
const SAVE_KEY = 'gameSecond_progress_v1';

function loadProgress() {
    try {
        const v = localStorage.getItem(SAVE_KEY);
        if (v === null) return 0;
        const n = parseInt(v, 10);
        return (isNaN(n) || n < 0) ? 0 : n;
    } catch (e) {
        return 0;
    }
}

function saveProgress(unlockedIndex) {
    try {
        localStorage.setItem(SAVE_KEY, String(unlockedIndex));
    } catch (e) {
        console.warn('[Level] 进度保存失败', e);
    }
}

function resetProgress() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch (e) {}
}
