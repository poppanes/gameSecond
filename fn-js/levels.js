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

// ============================================
// 上线配置开关（正式发布前逐项确认）
// ============================================
// 特殊关卡（BONUS）是否开放：false = 菜单隐藏该卡片 + 通关流程自动跳过
const SHOW_SPECIAL_LEVELS = true;
// 测试地图卡片是否显示：false = 菜单隐藏（开发者可按 ` 键临时呼出/关闭）
const SHOW_TEST_MAP = true;

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
// 禁区（自动跳过，无需避开）：四角出生点(0,0)(7,0)(0,6)(7,6)及相邻格、玩家起点(3,3)
// 传送门（可选配置）：关卡对象加 portals 门对数组，每对双向互通
//   { a: [0,2], b: [7,5] }  → 水平门：站 (0,2) 按左 → 到 (7,5)；站 (7,5) 按右 → 回 (0,2)
//   { a: [3,0], b: [3,6] }  → 垂直门：顶格按上 → 底格；底格按下 → 顶格
//   { a: [0,5], b: [4,3] }  → 不对等：左门 → 内部出口 (4,3)（内部格端单向，只进不出）
//   触发方向自动推导（端点在边缘：左门按左/顶门按上...）；可显式 { col, row, enter, face } 覆盖
//   规则：15 回合内的关卡不要配置；之后按关卡需求添加
// 传送门（可选配置）：关卡对象加 portals: [行号数组]（左右两侧成对开启）
//   效果：该行左右边缘出现门标记，角色/怪物站在门格(col 0 或 col 7)按朝外方向键 → 瞬移到对侧门格
//   规则：15 回合内的关卡不要配置；之后按关卡需求添加，如 { id: 16, ..., portals: [2, 5] }。
// 墙 = 空气墙：不可通行、不可翻转、豁免通关；WALL_VISIBLE 控制是否可见（见文件顶部）。
// 黑洞 = 地形黑洞：不可通行、不可翻转、豁免通关，怪物/玩家/箱子都无法进入。
// 特殊关卡（type:'bonus'）不使用布局，走 initEmpty 全白地板。
// ============================================
const LEVELS = [
    //1
    { id: 1,  name: 'ROUND 1', type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        "........",
        "....S...",
        "........",
        "...S....",
        "........",
        "........",
      ] },
    //2
    { id: 2,  name: 'ROUND 2', type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        ".S....S.",
        "........",
        "........",
        "........",
        ".S....S.",
        "........",
      ] },
    //3
    { id: 3,  name: 'ROUND 3', type: 'normal', tier: 1, enemies: { Ghost: 1, Spider: 1 },
      layout: [
        "........",
        "........",
        "....SSS.",
        "........",
        "........",
        "..SSS...",
        "........",
      ] },
    //4
    { id: 4,  name: 'ROUND 4', type: 'normal', tier: 1, enemies: { Ghost: 2, Spider: 1 },
      layout: [
        "........",
        "..S..B..",
        ".....SB.",
        "........",
        ".BS.....",
        "..B..S..",
        "........",
      ] },
    //Y1
    { id: 5,  name: 'BONUS 1', type: 'bonus', tier: 1 },
    //5
    { id: 6,  name: 'ROUND 5', type: 'normal', tier: 1, enemies: { Ghost: 2, Spider: 1 },
      layout: [
        "........",
        "......S.",
        "..S...B.",
        "..S...S.",
        "BSS.....",
        "........",
        "........",
      ] },
    //6
    { id: 7,  name: 'ROUND 6', type: 'normal', tier: 2, enemies: { Ghost: 1, Spider: 1, Snowman: 1 },
      layout: [
        "........",
        "........",
        ".SSBS.S.",
        "..S.S.B.",
        "......B.",
        "....BSS.",
        "........",
      ] },
    //7
    { id: 8,  name: 'ROUND 7', type: 'normal', tier: 2, enemies: { Owl: 1, Spider: 1, Snowman: 1 },
      layout: [
        "........",
        "....B...",
        "H.HHHB..",
        "....H...",
        "....H...",
        "........",
        "....H...",
      ] },
    //8
    { id: 9,  name: 'ROUND 8', type: 'normal', tier: 2, enemies: { Octopus: 1, Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "...SB...",
        "..B..B..",
        "..S..S..",
        "..B..B..",
        "...BS...",
        "........",
      ] },
    //Y2
    { id: 10, name: 'BONUS 2', type: 'bonus', tier: 2 },
    //9
    { id: 11, name: 'ROUND 9', type: 'normal', tier: 2, enemies: { Octopus: 1, Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "....HHHH",
        "....H...",
        "....B...",
        "....H...",
        "....HHHH",
        "........",
      ] },
    //10
    { id: 12, name: 'ROUND 10', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1 },
      layout: [
        "........",
        "...SS...",
        "H.HHHH.H",
        "....S...",
        "....S...",
        "...S....",
        "...S....",
      ] },
    //11
    { id: 13, name: 'ROUND 11', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1 },
      layout: [
        ".....S..",
        ".....H..",
        ".S...H..",
        ".SH.HH..",
        "..H..S..",
        "..H.....",
        "..H.S...",
      ] },
    //12
    { id: 14, name: 'ROUND 12', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 2 },
      layout: [
        "........",
        "..SBSBS.",
        ".S......",
        "..S.S.S.",
        ".S......",
        "..SBSBS.",
        "........",
      ] },
    //Y3
    { id: 15, name: 'BONUS 3', type: 'bonus', tier: 2 },
    //13
    { id: 16, name: 'ROUND 13', type: 'normal', tier: 2, enemies: { Spider: 1, Octopus: 1, Snowman: 1 },
      layout: [
        "........",
        "....B...",
        "....B...",
        "....B...",
        ".B.SSSB.",
        "........",
        "....B...",
      ] },
    //14
    { id: 17, name: 'ROUND 14', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1, Octopus: 1 },
      layout: [
        "........",
        ".SBB....",
        ".B......",
        ".SB.SBB.",
        ".B..B...",
        "....SB..",
        "....B...",
      ] },
    //15
    { id: 18, name: 'ROUND 15', type: 'normal', tier: 2, enemies: { Ghost: 1, Octopus: 1, Owl: 1 }, portals:[(0,3),(7,3)],
      layout: [
        "........",
        "..SS.SS.",
        ".S....S.",
        "......S.",
        "..BBBB..",
        "........",
        "........",
      ] },
    //16
    { id: 19, name: 'ROUND 16', type: 'normal', tier: 2, enemies: { Ghost: 1, Octopus: 1, Snowman: 1 }, portals:[(0,3),(7,3)],
      layout: [
        "........",
        ".S..S.B.",
        ".B.B....",
        ".SS...B.",
        ".B.B....",
        ".S..S.B.",
        "........",
      ] },
    //Y4
    { id: 20, name: 'BONUS 4', type: 'bonus', tier: 2 },
    //17
    { id: 21, name: 'ROUND 17', type: 'normal', tier: 2, enemies: { Ghost: 1, Octopus: 1, Snowman: 1  },portals:[(0,3),(7,3)],
      layout: [
        "........",
        "..S..SB.",
        ".SHH.H..",
        "..B..B..",
        "..H.HHS.",
        ".BS..S..",
        "........",
      ] },
    //18
    { id: 22, name: 'ROUND 18', type: 'normal', tier: 2, enemies: { Octopus: 1, Snowman: 2 },portals:[(0,3),(7,3)],
      layout: [
        "........",
        "..S..S..",
        ".B....B.",
        ".S....S.",
        ".B....B.",
        "..S..S..",
        "........",
      ] },
    //19
    { id: 23, name: 'ROUND 19', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "...H....",
        "...H....",
        ".B.HH.HH",
        "....H.H.",
        ".B.H...B",
        "...H....",
        "...H....",
      ] },
    //20
    { id: 24, name: 'ROUND 20', type: 'normal', tier: 2, enemies: { Ghost: 1, Octopus: 1, Snowman: 2 },portals:[(0,3),(7,3)],
      layout: [
        "........",
        "........",
        "SSBSSBBS",
        "........",
        "SBSSBSSB",
        "........",
        "........",
      ] },
    //Y5
    { id: 25, name: 'BONUS 5', type: 'bonus', tier: 2 },
    //21
    { id: 26, name: 'ROUND 21', type: 'normal', tier: 2, enemies: {Ghost: 1, Octopus: 1, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "..S.....",
        ".S..B...",
        "..B.SBS.",
        "BS....B.",
        ".SSSS.SS",
        ".S..B...",
        "........",
      ] },
    //22
    { id: 27, name: 'ROUND 22', type: 'normal', tier: 2, enemies: { Spider: 1, Owl: 1, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "....B...",
        "....S...",
        "..BBS.SB",
        "....S.B.",
        "..BBS.SB",
        "....S...",
        "....B...",
      ] },
    //23
    { id: 28, name: 'ROUND 23', type: 'normal', tier: 2, enemies: { Ghost: 1, Octopus: 1, Snowman: 1 },portals:[(0,1),(7,1),(0,5),(7,5)],
      layout: [
        "...S....",
        "...S....",
        "SSS.....",
        ".....SSB",
        "B..BS...",
        ".BB.S...",
        "....S...",
      ] },
    //24
    { id: 29, name: 'ROUND 24', type: 'normal', tier: 2, enemies: { Spider: 1, Octopus: 1, Snowman: 1 },portals:[(0,1),(7,1),(0,5),(7,5)],
      layout: [
        ".....B..",
        "..SSSSS.",
        "..B.....",
        "..S.....",
        "..B.....",
        "..SSSSS.",
        ".....B..",
      ] },
    //Y6
    { id: 30, name: 'BONUS 6', type: 'bonus', tier: 2 },
    //25
    { id: 31, name: 'ROUND 25', type: 'normal', tier: 2, enemies: { Spider: 1, Octopus: 1, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "..S..S..",
        "..B..B..",
        "...SB...",
        "........",
        "...BS...",
        "..B..B..",
        "..S..S..",
      ] },
    //26
    { id: 32, name: 'ROUND 26', type: 'normal', tier: 2, enemies: { Octopus: 2, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "........",
        "..BBBB..",
        "........",
        ".B....B.",
        "........",
        "..BBBB..",
        "........",
      ] },
    //27
    { id: 33, name: 'ROUND 27', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1, Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "........",
        "..B.....",
        ".BSB....",
        "..B..B..",
        "....BSB.",
        ".....B..",
        "........",
      ] },
    //28
    { id: 34, name: 'ROUND 28', type: 'normal', tier: 2, enemies: { Spider: 1, Ghost: 1, Snowman: 1 },portals:[(0,1),(7,1),(0,5),(7,5)],
      layout: [
        "..S..S..",
        ".S....S.",
        "..SBS...",
        "BS...B..",
        "..S..S..",
        "...S.S..",
        "....S...",
      ] },
    //Y7
    { id: 35, name: 'BONUS 7', type: 'bonus', tier: 2 },
    //29
    { id: 36, name: 'ROUND 29', type: 'normal', tier: 2, enemies: { Owl: 2,Snowman: 1 },portals:[(0,3),(7,3)],
      layout: [
        "....H...",
        ".....B..",
        ".S..H...",
        ".B..H...",
        "....H...",
        "...B....",
        "....H...",
      ] },
    //30
    { id: 37, name: 'ROUND 30', type: 'normal', tier: 2, enemies: { Spider: 1, Snowman: 2 },
      layout: [
        "..H.S...",
        "..H..B..",
        ".SSS....",
        "........",
        ".B....S.",
        ".HHH.S..",
        ".....B..",
      ] },
    { id: 38, name: 'BOSS 幽灵王', type: 'boss' },
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
