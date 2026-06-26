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
        spawnGhost();
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
            // 更新玩家平滑移动
            if (player) player.update(dt);
            // 玩家碰撞敌人检测（硬直中/拾取中怪物不触发）
            if (player && !player.isDead()) {
                for (const e of enemies) {
                    if (e && e.alive === true && e.stunned <= 0 && !e.carried &&
                        e.gridX === player.gridX && e.gridY === player.gridY) {
                        e._hitPlayer();
                        break;
                    }
                }
            }
            // 通关检测：只要所有地板已变灰色即通关
            if (map && map.areAllFlipped()) {
                // 清空敌人延迟翻转，避免翻转动画拖尾
                clearAllFlips();
                this.gameWin = true;
                gameInput.enabled = false;
                console.log('[Game] 通关！');
            }
        }
    }
    
    render() {
        // 清空画布
        this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        // 绘制地图
        if (map) {
            map.draw();
        }
        
        // 绘制翻转动画（覆盖在格子上层）
        drawFlipAnimations();
        
        // 绘制道具
        items.forEach(item => item.draw(this.ctx));
        
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
    
    // 重新开始游戏
    restart() {
        this.init();
    }
}

// ============================================
// 启动游戏
// ============================================
let game;  // 全局引用，供 input.js 重启用
window.addEventListener('load', function() {
    game = new Game();
    game.start();
});
