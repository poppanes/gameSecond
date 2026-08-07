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
class GameInput extends InputHandler {
    constructor(player) {
        super();
        this.player = player;
        this.moveDelay = 150;
        this.lastMoveTime = 0;
        this.enabled = true;
    }
    
    // 重启时更新玩家引用（不重复绑定键盘事件）
    updatePlayer(player) {
        this.player = player;
        this.lastMoveTime = 0;
        this.enabled = true;
    }
    
    onKeyDown(code) {
        // 游戏结束：空格键重新开始
        if (!this.enabled) {
            if (code === 'Space') {
                game.restart('Space键');
            }
            return;
        }
        const now = Date.now();
        
        // 移动键节流：只对移动键生效，不影响 J 键等技能键
        const isMoveKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                           'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(code);
        if (isMoveKey && now - this.lastMoveTime < this.moveDelay) return;
        
        switch(code) {
            case 'ArrowUp':
            case 'KeyW':
                this.player.move(0, -1);
                this.lastMoveTime = now;
                break;
                
            case 'ArrowDown':
            case 'KeyS':
                this.player.move(0, 1);
                this.lastMoveTime = now;
                break;
                
            case 'ArrowLeft':
            case 'KeyA':
                this.player.move(-1, 0);
                this.lastMoveTime = now;
                break;
                
            case 'ArrowRight':
            case 'KeyD':
                this.player.move(1, 0);
                this.lastMoveTime = now;
                break;
                
            case 'KeyJ':
                this.player.flipCurrentTile();
                break;
                
            case 'KeyK':
                this.player.interactGhost();
                break;
        }
    }
}
