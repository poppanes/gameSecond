// ============================================
// CRT 电玩屏特效层（扫描线 / 暗角 / 玻璃反光 / 微闪烁）
// 纯 CSS 覆盖层实现，零 canvas 性能损耗
// ============================================
(function () {
    function init() {
        const canvas = document.getElementById('canvas1');
        if (!canvas || document.querySelector('.crt-wrap')) return;

        // 用包裹层定位覆盖层（与画布严格对齐）
        const wrap = document.createElement('div');
        wrap.className = 'crt-wrap';
        canvas.parentNode.insertBefore(wrap, canvas);
        wrap.appendChild(canvas);

        const overlay = document.createElement('div');
        overlay.className = 'crt-overlay';
        wrap.appendChild(overlay);

        // 开机动画：水平线展开（一次性，0.7s 后移除动画类）
        wrap.classList.add('crt-turn-on');
        setTimeout(() => wrap.classList.remove('crt-turn-on'), 700);

        // 受击屏幕抖动（player.takeDamage 调用 window.crtShake()）
        window.crtShake = function () {
            wrap.classList.add('shake');
            setTimeout(() => wrap.classList.remove('shake'), 320);
        };

        // 预热像素字体（canvas 首帧即可用，未加载完自动降级等宽字体）
        if (document.fonts && document.fonts.load) {
            document.fonts.load('16px "Press Start 2P"');
            document.fonts.load('26px "Press Start 2P"');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
