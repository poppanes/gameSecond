// ============================================
// 输入控制器
// ============================================
class InputHandler {
    constructor() {
        this.keys = {};
        this.bindEvents();
    }
    
    bindEvents() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }
            
            this.onKeyDown(e.code);
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            if (typeof this.onKeyUp === 'function') this.onKeyUp(e.code);
        });
    }
    
    // 基类空实现，子类按需重写
    onKeyDown(code) {}
    onKeyUp(code) {}
    
}

// ============================================
// 游戏输入控制器
// ============================================
// 转向加速倍率：移动中按新方向时，当前格按此倍率加速走完（缩短转向延迟）
const TURN_BOOST = 2;

class GameInput extends InputHandler {
    constructor(player) {
        super();
        this.player = player;
        this.enabled = true;
        this.pressedDirs = [];   // 当前按住的方向栈（后按的优先）
        this._lastMoveTry = 0;   // 上次尝试移动的时间戳（防止撞墙时每帧刷日志）
    }
    
    // 重启时更新玩家引用（不重复绑定键盘事件）
    updatePlayer(player) {
        this.player = player;
        this.pressedDirs = [];   // 换关/重开时清空按住状态
        this.enabled = true;
    }
    
    // 按键 → 方向向量（非方向键返回 null）
    _codeToDir(code) {
        switch (code) {
            case 'ArrowUp': case 'KeyW': return { dx: 0, dy: -1 };
            case 'ArrowDown': case 'KeyS': return { dx: 0, dy: 1 };
            case 'ArrowLeft': case 'KeyA': return { dx: -1, dy: 0 };
            case 'ArrowRight': case 'KeyD': return { dx: 1, dy: 0 };
        }
        return null;
    }
    
    // 每帧驱动：按住方向键时，走完一格立即续下一格（不再等 keydown repeat）
    update() {
        if (!this.enabled || !this.player) return;
        
        const dir = this.pressedDirs[this.pressedDirs.length - 1];
        if (!dir) return;   // 没有按住方向键
        
        if (this.player.isMoving) {
            // 移动中按住不同方向 → 本格加速走完（缩短转向延迟，位置仍连续无跳变）
            const cur = this.player.lastMoveDir;
            const turning = cur && (cur.dx !== dir.dx || cur.dy !== dir.dy);
            this.player.boost = turning ? TURN_BOOST : 1;
            return;
        }
        
        // 撞墙时降低尝试频率（避免每帧调 pushBox 产生大量日志）
        const now = performance.now();
        if (now - this._lastMoveTry < 50) return;
        this._lastMoveTry = now;
        
        this.player.boost = 1;
        this.player.move(dir.dx, dir.dy);
    }
    
    onKeyDown(code) {
        // 菜单模式：转发给 game 处理关卡选择
        if (game && game.mode === 'menu') {
            game.menuKeyDown(code);
            return;
        }
        // 测试地图：测试专用键转发（移动键仍走下方正常移动逻辑）
        if (game && game.testMode) {
            const testKeys = ['Digit1','Digit2','Digit3','Digit4','Digit5',
                              'KeyQ','KeyE','KeyR','KeyT','KeyC','KeyG',
                              'Escape','Backspace'];
            if (testKeys.includes(code)) {
                game.testKeyDown(code);
                return;
            }
        }
        // 游戏结束：空格键重新开始
        if (!this.enabled) {
            if (code === 'Space') {
                game.restart('Space键');
            }
            return;
        }
        
        // 方向键：入栈（后按的优先），并立即响应（不等下一帧）
        const dir = this._codeToDir(code);
        if (dir) {
            this.pressedDirs = this.pressedDirs.filter(d => !(d.dx === dir.dx && d.dy === dir.dy));
            this.pressedDirs.push(dir);
            if (!this.player.isMoving) this.player.move(dir.dx, dir.dy);
            return;
        }
        
        switch(code) {
            case 'KeyJ':
                this.player.flipCurrentTile();
                break;
                
            case 'KeyK':
                this.player.interactGhost();
                break;
        }
    }
    
    // 松开方向键：从栈中移除
    onKeyUp(code) {
        const dir = this._codeToDir(code);
        if (dir) {
            this.pressedDirs = this.pressedDirs.filter(d => !(d.dx === dir.dx && d.dy === dir.dy));
        }
    }
}
