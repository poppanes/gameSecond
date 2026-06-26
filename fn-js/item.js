// ============================================
// 道具系统
// ============================================
const items = [];

// 道具类型定义
const ITEM_TYPES = {
    cherry:    { name: '樱桃',  src: '../fn-image/item/cherry.png',      category: 'fruit',  score: 100 },
    apple:     { name: '苹果',  src: '../fn-image/item/apple.png',       category: 'fruit',  score: 200 },
    peach:     { name: '桃子',  src: '../fn-image/item/peach.png',       category: 'fruit',  score: 400 },
    watermelon:{ name: '西瓜',  src: '../fn-image/item/watermelon.png',  category: 'fruit',  score: 800 },
    icecream:  { name: '雪糕',  src: '../fn-image/item/icecream.png',    category: 'fruit',  score: 5000 },
    time:      { name: '沙漏',  src: '../fn-image/item/time.png',        category: 'time',   score: 0 },
    hammer:    { name: '铁锤',  src: '../fn-image/item/hammer.png',      category: 'hammer', score: 0 },
};

// 水果类型列表（用于随机）
const FRUIT_TYPES = ['peach', 'apple', 'cherry', 'watermelon', 'icecream'];

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
    }
    
    draw(ctx) {
        if (!this.imageLoaded) return;
        const x = OFFSET_X + this.gridX * CELL_SIZE + BORDER_WIDTH;
        const y = OFFSET_Y + this.gridY * CELL_SIZE + BORDER_WIDTH;
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
                killAllEnemies();  // 击杀全部敌人
                if (typeof enemies !== 'undefined' && enemies) {
                    enemies.length = 0;
                }
                break;
        }
    }
}

// ============================================
// 道具生成（箱子消失时调用）
// ============================================
function spawnItem(col, row) {
    const roll = Math.random();
    console.log(`[spawnItem] 随机值=${roll.toFixed(2)} (>=0.7则不生成)`);
    if (roll >= 0.7) {
        console.log(`[spawnItem] → 没有道具掉落 (${(roll*100).toFixed(0)}%)`);
        return;
    }
    
    const itemRoll = Math.random();
    let type;
    
    if (itemRoll < 0.15) {
        type = 'time';
    } else if (itemRoll < 0.30) {
        type = 'hammer';
    } else {
        type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    }
    
    console.log(`[spawnItem] → 生成道具: ${ITEM_TYPES[type].name} 位置(${col},${row})`);
    items.push(new Item(type, col, row));
}

// 检查指定位置是否有道具，有则拾取
function pickupItem(col, row) {
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].gridX === col && items[i].gridY === row) {
            const info = ITEM_TYPES[items[i].type];
            if (info.category === 'hammer') {
                console.log(`[pickupItem] → 拾取: ${info.name} 击杀全部怪物`);
            } else if (info.category === 'time') {
                console.log(`[pickupItem] → 拾取: ${info.name} +10秒`);
            } else {
                console.log(`[pickupItem] → 拾取: ${info.name} +${info.score}分`);
            }
            items[i].onPickup();
            items.splice(i, 1);
            return true;
        }
    }
    return false;
}
