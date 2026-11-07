# 长期记忆

## 评估文档
- [移动端技术评估](mobile-assessment.md) — 技术栈选型（H5 先行/微信小游戏二期）、工作分解约 3~3.5 天、显示方案与风险。2026-10-20 定稿，开工时按此执行。

## 项目：gameSecond（翻板消除 + 推箱玩法，纯 HTML/Canvas/JS）
- 结构：fn-html（入口页面）、fn-js（game/player/enemy/input/map/animation/item/levels/main）、fn-image（素材）。
- 主循环：game.js `loop()` → `update(dt)`（player.update 在前）→ `gameInput.update()`（续格移动）→ `render()`。CELL_SIZE=88。
- 角色：方块猪 v3 帧表（fn-image/pig_v3_*.png，88px 单帧，原始朝右、左向镜像翻转）。walk 8帧 / push 4帧 / pick 5帧。行走帧钟与位移锁定（player.js walkTime 机制，2026-10-12 实现），PIG_WALK_FRAMES_PER_CELL=3。
- 移动：moveSpeed=0.40 px/ms（约220ms/格），转向加速 TURN_BOOST=2；isMoving 期间不接受新输入，走完一格由 gameInput.update() 续格。

## Git / GitHub
- 远程：`git@github.com:poppanes/gameSecond.git`（GitHub 账号 poppanes，Public 仓库，SSH 认证可用）。
- 工作分支：`feature/bonus-round-all-fixes`；master 仅本地旧提交（2026-10-12 状态：master 未合并 feature，未推送）。
- **重要偏好：用户要自己控制上传时机——未经明确要求，不要主动 git commit / push / 合并分支**；等用户说"上传/推送"时再操作（2026-10-12 用户明确指示）。
- Dashboard 左侧 "Top repositories" 不一定列出全部仓库，直接访问 https://github.com/poppanes/gameSecond。
