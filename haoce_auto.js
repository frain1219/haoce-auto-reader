/**
 * 好策APP自动阅读脚本
 * 功能：自动翻页阅读，模拟人类阅读行为
 * 版本：2.6
 * 更新时间：2026-03-14
 * 
 * 特性：
 * 1. 悬浮窗居中显示，支持速度选择
 * 2. 曲线滑动轨迹，模拟真实手指滑动
 * 3. 随机化参数，避免被检测
 * 4. 智能底部检测，显示触发规则
 * 5. 优化的左滑翻页功能
 * 6. 实时倒计时显示，每秒动态更新
 * 
 * 使用方法：
 * 1. 打开好策APP，进入阅读页面
 * 2. 运行脚本，选择阅读速度
 * 3. 点击"开始"按钮开始阅读
 * 4. 拖动悬浮窗标题可移动位置
 */

auto.waitFor();

// ==================== 全局配置参数 ====================

// 屏幕尺寸
var screenWidth = device.width;      // 屏幕宽度（像素）
var screenHeight = device.height;    // 屏幕高度（像素）

// 滑动参数（已废弃，使用随机化参数）
var swipeStartY = screenHeight * 0.7;  // 滑动起始Y坐标（屏幕70%位置）
var swipeEndY = screenHeight * 0.3;    // 滑动结束Y坐标（屏幕30%位置）
var swipeX = screenWidth / 2;          // 滑动X坐标（屏幕中央）
var swipeDuration = 500;               // 滑动持续时间（毫秒）
var waitTime = 2000;                   // 等待时间（毫秒）
var chapterWaitTime = 3000;            // 章节切换等待时间（毫秒）

// 运行状态
var isRunning = false;                 // 是否正在运行
var bottomDetectCount = 0;             // 底部检测计数
var maxBottomDetectCount = 3;          // 最大底部检测次数（连续检测到3次底部才切换章节）
var similarityThreshold = 0.95;        // 图片相似度阈值（>0.95判定为到达底部）

// 悬浮窗
var window = null;                     // 悬浮窗对象
var isMinimized = false;               // 是否最小化
var currentSpeedName = "normal";       // 当前速度名称
var countdownThread = null;           // 倒计时线程

/**
 * 阅读速度配置
 * 
 * 计算依据：
 * - 好策显示特性：一行14字，最多24行，共336字/屏
 * - 人类阅读速度：平均300字/分钟（即5字/秒）
 * 
 * 每次下滑逻辑：
 * - 下滑距离：minLines到maxLines行
 * - 新加载内容：minLines到maxLines行（约14×minLines到14×maxLines字）
 * - 阅读时间：新内容字数 ÷ 300字/分钟 × 60秒
 * 
 * 示例（normal模式）：
 * - 下滑5-8行，新加载70-112字
 * - 阅读时间：70-112字 ÷ 300字/分钟 × 60秒 = 14-22秒
 * 
 * 重要说明：
 * - 等待时间仅用于阅读新加载的内容
 * - 用户不需要重新阅读已读内容
 * - 每次下滑后，屏幕上大部分是已读内容，只有底部5-8行是新内容
 */
var readingSpeed = {
    // 慢速模式：每次下滑3-5行，阅读时间20-30秒
    slow: { 
        minTime: 20000,    // 最小等待时间（毫秒）
        maxTime: 30000,    // 最大等待时间（毫秒）
        minLines: 3,       // 最小下滑行数
        maxLines: 5        // 最大下滑行数
    },
    
    // 正常模式：每次下滑5-8行，阅读时间14-22秒（推荐）
    normal: { 
        minTime: 14000,    // 最小等待时间（毫秒）
        maxTime: 22000,    // 最大等待时间（毫秒）
        minLines: 5,       // 最小下滑行数
        maxLines: 8        // 最大下滑行数
    },
    
    // 快速模式：每次下滑8-12行，阅读时间8-14秒
    fast: { 
        minTime: 8000,     // 最小等待时间（毫秒）
        maxTime: 14000,    // 最大等待时间（毫秒）
        minLines: 8,       // 最小下滑行数
        maxLines: 12       // 最大下滑行数
    }
};

var currentSpeed = readingSpeed.normal;  // 当前阅读速度（默认：正常模式）

// ==================== 初始化 ====================

toast("正在请求截图权限...");

if (!requestScreenCapture()) {
    toast("截图权限请求失败，请手动授权");
    exit();
}

toast("截图权限已获取，启动悬浮窗...");

createFloatyWindow();

// ==================== 工具函数 ====================

/**
 * 生成指定范围内的随机整数
 * @param {number} min - 最小值（包含）
 * @param {number} max - 最大值（包含）
 * @returns {number} 随机整数
 */
function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 获取随机下滑距离
 * 
 * 计算逻辑：
 * 1. 随机选择下滑行数（基于当前阅读速度配置）
 * 2. 计算每行高度（屏幕高度 ÷ 24行）
 * 3. 返回下滑距离（行数 × 行高）
 * 
 * @returns {number} 下滑距离（像素）
 */
function getRandomSwipeDistance() {
    var lines = random(currentSpeed.minLines, currentSpeed.maxLines);
    var lineHeight = screenHeight / 24;
    var distance = lines * lineHeight;
    return distance;
}

/**
 * 获取随机等待时间
 * 
 * 计算逻辑详解：
 * 
 * 1. 每次下滑情况：
 *    - 下滑5-8行（normal模式）
 *    - 新加载内容：5-8行 × 14字/行 = 70-112字
 *    - 这部分是用户需要阅读的新内容
 * 
 * 2. 等待时间计算：
 *    - 阅读新内容时间：70-112字 ÷ 5字/秒 = 14-22秒
 *    - 添加±20%随机波动，模拟阅读速度变化
 * 
 * 3. 重要说明：
 *    - 用户不需要重新阅读已读内容
 *    - 只需要阅读新加载的5-8行内容
 *    - 因此等待时间仅计算新内容的阅读时间
 * 
 * @returns {number} 等待时间（毫秒）
 */
function getRandomWaitTime() {
    // 获取基础等待时间（对应阅读新加载内容的时间）
    var baseTime = random(currentSpeed.minTime, currentSpeed.maxTime);
    
    // 添加±20%的随机波动，模拟人类阅读速度的自然变化
    var variation = baseTime * (random(-20, 20) / 100);
    
    return Math.floor(baseTime + variation);
}

/**
 * 获取随机滑动持续时间
 * @returns {number} 滑动持续时间（毫秒）
 */
function getRandomSwipeDuration() {
    return random(300, 800);
}

/**
 * 执行曲线滑动
 * 
 * 实现原理：
 * 1. 使用正弦函数生成平滑曲线：curve = sin(t × π) × offsetX
 * 2. 曲线在中间位置偏移最大，两端偏移最小
 * 3. 添加随机偏移（±20px），模拟手指滑动轨迹
 * 4. 添加轻微抖动（±2px），模拟真实手指微颤
 * 
 * @param {number} startX - 起始X坐标
 * @param {number} startY - 起始Y坐标
 * @param {number} endX - 结束X坐标
 * @param {number} endY - 结束Y坐标
 * @param {number} duration - 滑动持续时间（毫秒）
 * @param {number} curveOffset - 曲线偏移量（可选，默认±20px）
 */
function curvedSwipe(startX, startY, endX, endY, duration, curveOffset) {
    // 生成曲线轨迹点数组
    var points = [];
    var steps = Math.floor(duration / 10);  // 每10ms一个点
    
    // 随机偏移量，用于生成曲线（水平滑动时使用较小的偏移）
    var offsetX = curveOffset !== undefined ? curveOffset : random(-20, 20);
    
    // 计算每个轨迹点
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;  // 归一化时间参数 [0, 1]
        
        // 线性插值计算基础坐标
        var x = startX + (endX - startX) * t;
        var y = startY + (endY - startY) * t;
        
        // 添加曲线偏移（正弦函数，中间最大，两端最小）
        var curve = Math.sin(t * Math.PI) * offsetX;
        x += curve;
        
        // 添加轻微随机抖动，模拟手指微颤
        x += random(-2, 2);
        y += random(-2, 2);
        
        points.push([Math.floor(x), Math.floor(y)]);
    }
    
    // 使用gesture函数执行曲线滑动
    gesture.apply(null, [duration].concat(points));
}

/**
 * 模拟阅读停顿
 * 
 * 功能：偶尔停顿更长时间，模拟思考或回看的行为
 * 概率：15%的概率触发停顿
 * 停顿时间：3-8秒
 */
function simulateReadingPause() {
    if (random(0, 100) < 15) {
        var pauseTime = random(3000, 8000);
        log("模拟阅读停顿: " + pauseTime + "ms");
        sleep(pauseTime);
    }
}

/**
 * 启动倒计时显示（使用线程实现）
 * 
 * 功能：
 * 1. 在独立线程中运行倒计时
 * 2. 每秒更新一次UI
 * 3. 倒计时结束时显示"等待完成"
 * 
 * @param {number} seconds - 倒计时秒数
 */
function startCountdown(seconds) {
    // 停止之前的倒计时（如果有）
    stopCountdown();
    
    // 启动新线程执行倒计时
    countdownThread = threads.start(function() {
        var remainingSeconds = seconds;
        
        // 更新初始显示
        ui.run(function() {
            window.waitTimeText.setText("等待: " + remainingSeconds + "秒");
        });
        
        // 倒计时循环
        while (remainingSeconds > 0 && isRunning) {
            sleep(1000);  // 在线程中sleep不会阻塞主线程
            remainingSeconds--;
            
            if (remainingSeconds > 0) {
                ui.run(function() {
                    window.waitTimeText.setText("等待: " + remainingSeconds + "秒");
                });
            } else if (remainingSeconds === 0) {
                ui.run(function() {
                    window.waitTimeText.setText("等待完成");
                });
            }
        }
    });
}

/**
 * 停止倒计时
 */
function stopCountdown() {
    if (countdownThread) {
        countdownThread.interrupt();  // 中断线程
        countdownThread = null;
    }
}

// ==================== 悬浮窗控制 ====================

/**
 * 创建悬浮窗
 */
function createFloatyWindow() {
    window = floaty.window(
        <frame gravity="center">
            <vertical bg="#E0000000" padding="12" w="auto" h="auto">
                <text id="titleText" text="好策阅读" textColor="#FFFFFF" textSize="16sp" gravity="center" marginBottom="8"/>
                <text id="statusText" text="状态: 就绪" textColor="#AAAAAA" textSize="12sp" gravity="center" marginBottom="4"/>
                <text id="waitTimeText" text="等待: 0秒" textColor="#FFA500" textSize="11sp" gravity="center" marginBottom="4"/>
                
                <horizontal id="speedArea" gravity="center" marginBottom="8">
                    <text text="速度:" textColor="#FFFFFF" textSize="14sp" marginRight="8"/>
                    <button id="slowBtn" text="慢速" w="60" h="35" textSize="12sp" bg="#666666"/>
                    <button id="normalBtn" text="正常" w="60" h="35" textSize="12sp" bg="#2196F3"/>
                    <button id="fastBtn" text="快速" w="60" h="35" textSize="12sp" bg="#666666"/>
                </horizontal>
                
                <text id="ruleText" text="" textColor="#FFA500" textSize="11sp" gravity="center" marginBottom="8"/>
                
                <horizontal gravity="center">
                    <button id="actionBtn" text="开始" w="80" h="40" style="Widget.AppCompat.Button.Colored"/>
                    <button id="exitBtn" text="退出" w="80" h="40" marginLeft="8"/>
                </horizontal>
            </vertical>
        </frame>
    );

    // 计算悬浮窗居中位置
    var windowWidth = 280;  // 悬浮窗宽度（估算）
    var windowHeight = 240; // 悬浮窗高度（估算）
    var windowX = (screenWidth - windowWidth) / 2;
    var windowY = (screenHeight - windowHeight) / 5;  // 屏幕上方1/5位置
    
    // 设置悬浮窗初始位置（屏幕中央偏上）
    window.setPosition(windowX, windowY);

    // 速度按钮点击事件
    window.slowBtn.click(function() {
        currentSpeed = readingSpeed.slow;
        currentSpeedName = "slow";
        updateSpeedButtons();
        toast("已切换到慢速模式");
    });

    window.normalBtn.click(function() {
        currentSpeed = readingSpeed.normal;
        currentSpeedName = "normal";
        updateSpeedButtons();
        toast("已切换到正常模式");
    });

    window.fastBtn.click(function() {
        currentSpeed = readingSpeed.fast;
        currentSpeedName = "fast";
        updateSpeedButtons();
        toast("已切换到快速模式");
    });

    // 开始/停止按钮点击事件
    window.actionBtn.click(function() {
        if (isRunning) {
            stopReading();
        } else {
            startReading();
        }
    });

    // 退出按钮点击事件
    window.exitBtn.click(function() {
        exit();
    });

    // 悬浮窗拖动功能
    var isDragging = false;
    var startX, startY, windowX, windowY;

    window.titleText.setOnTouchListener(function(view, event) {
        switch (event.getAction()) {
            case event.ACTION_DOWN:
                isDragging = true;
                startX = event.getRawX();
                startY = event.getRawY();
                windowX = window.getX();
                windowY = window.getY();
                return true;
            case event.ACTION_MOVE:
                if (isDragging) {
                    var dx = event.getRawX() - startX;
                    var dy = event.getRawY() - startY;
                    window.setPosition(windowX + dx, windowY + dy);
                }
                return true;
            case event.ACTION_UP:
            case event.ACTION_CANCEL:
                isDragging = false;
                return true;
        }
        return false;
    });

    toast("悬浮窗已创建，拖动标题可移动位置");
}

/**
 * 更新速度按钮显示状态
 */
function updateSpeedButtons() {
    ui.run(function() {
        // 重置所有按钮背景颜色（灰色）
        window.slowBtn.setBackgroundColor(colors.parseColor("#666666"));
        window.normalBtn.setBackgroundColor(colors.parseColor("#666666"));
        window.fastBtn.setBackgroundColor(colors.parseColor("#666666"));
        
        // 高亮当前选中的按钮（蓝色）
        switch (currentSpeedName) {
            case "slow":
                window.slowBtn.setBackgroundColor(colors.parseColor("#2196F3"));
                break;
            case "normal":
                window.normalBtn.setBackgroundColor(colors.parseColor("#2196F3"));
                break;
            case "fast":
                window.fastBtn.setBackgroundColor(colors.parseColor("#2196F3"));
                break;
        }
    });
}

/**
 * 开始阅读
 */
function startReading() {
    isRunning = true;
    window.actionBtn.setText("停止");
    
    // 隐藏速度选择区域
    ui.run(function() {
        window.speedArea.setVisibility(8);  // 8 = View.GONE
        window.statusText.setText("状态: 运行中...");
        window.waitTimeText.setText("等待: 0秒");
        window.ruleText.setText("");
    });
    
    toast("开始自动阅读");
    
    // 在新线程中启动主循环
    threads.start(function() {
        mainLoop();
    });
}

/**
 * 停止阅读
 */
function stopReading() {
    isRunning = false;
    window.actionBtn.setText("开始");
    
    // 停止倒计时
    stopCountdown();
    
    // 显示速度选择区域
    ui.run(function() {
        window.speedArea.setVisibility(0);  // 0 = View.VISIBLE
        window.statusText.setText("状态: 已停止");
        window.waitTimeText.setText("等待: 0秒");
    });
    
    toast("已停止阅读");
}

// ==================== 主循环 ====================

/**
 * 主循环
 * 
 * 流程：
 * 1. 执行下滑，加载新内容
 * 2. 等待用户阅读新内容
 * 3. 检测是否到达页面底部
 * 4. 如果到底部，切换下一章
 */
function mainLoop() {
    while (isRunning) {
        try {
            // 滑动前截图（用于检测是否到达底部）
            var beforeImg = captureScreen();

            // 执行下滑，加载新内容
            performSwipeDown();

            // 等待用户阅读新加载的内容
            // 注意：只阅读新加载的5-8行，不包括已读内容
            var currentWaitTime = getRandomWaitTime();
            var waitSeconds = Math.floor(currentWaitTime / 1000);
            
            // 启动倒计时
            startCountdown(waitSeconds);
            
            log("等待时间: " + currentWaitTime + "ms（阅读新加载内容）");
            sleep(currentWaitTime);

            // 停止倒计时
            stopCountdown();

            // 偶尔停顿，模拟思考或回看
            simulateReadingPause();

            // 滑动后截图（用于检测是否到达底部）
            var afterImg = captureScreen();

            // 检测是否到达页面底部，并获取触发的规则
            var bottomResult = isAtBottom(beforeImg, afterImg);
            
            if (bottomResult.isBottom) {
                bottomDetectCount++;
                
                // 显示触发的规则
                var ruleText = "触发规则: " + bottomResult.reasons.join(", ");
                ui.run(function() {
                    window.statusText.setText("检测到底部 (" + bottomDetectCount + "/" + maxBottomDetectCount + ")");
                    window.ruleText.setText(ruleText);
                });
                
                log("底部检测详情: " + ruleText);

                // 连续检测到3次底部，切换下一章
                if (bottomDetectCount >= maxBottomDetectCount) {
                    toast("切换下一章");
                    ui.run(function() {
                        window.statusText.setText("切换章节...");
                        window.ruleText.setText("");
                    });

                    performSwipeLeft();
                    sleep(chapterWaitTime);
                    bottomDetectCount = 0;
                }
            } else {
                bottomDetectCount = 0;
                ui.run(function() {
                    window.statusText.setText("阅读中...");
                    window.ruleText.setText("");
                });
            }

            // 释放图片资源
            if (beforeImg && beforeImg.recycle) beforeImg.recycle();
            if (afterImg && afterImg.recycle) afterImg.recycle();

        } catch (e) {
            log("错误: " + e.toString());
            ui.run(function() {
                window.statusText.setText("错误: " + e.message);
            });
            sleep(1000);
        }
    }
}

// ==================== 滑动操作 ====================

/**
 * 执行下滑操作
 * 
 * 功能：
 * 1. 随机化下滑距离（5-8行）
 * 2. 随机化滑动起点和终点位置
 * 3. 使用曲线滑动轨迹
 */
function performSwipeDown() {
    // 获取随机下滑距离
    var swipeDistance = getRandomSwipeDistance();
    var startY = screenHeight * 0.7;
    var endY = startY - swipeDistance;
    
    // 随机化X坐标（屏幕中央±50px）
    var centerX = screenWidth / 2;
    var startX = centerX + random(-50, 50);
    var endX = centerX + random(-50, 50);
    
    // 获取随机滑动速度
    var duration = getRandomSwipeDuration();
    
    log("下滑距离: " + Math.floor(swipeDistance) + "px, 时长: " + duration + "ms");
    
    // 执行曲线滑动
    curvedSwipe(startX, startY, endX, endY, duration);
}

/**
 * 执行左滑操作（切换章节）
 * 
 * 优化：
 * 1. 使用标准swipe函数，确保稳定性
 * 2. 调整滑动距离为屏幕宽度的60%
 * 3. 调整滑动速度为500-800ms
 * 4. Y坐标固定在屏幕中央
 */
function performSwipeLeft() {
    // 滑动距离：屏幕宽度的60%（从80%到20%）
    var startX = screenWidth * 0.8;
    var endX = screenWidth * 0.2;
    
    // Y坐标固定在屏幕中央（不添加随机偏移，确保水平滑动）
    var y = screenHeight * 0.5;
    
    // 滑动速度：500-800ms
    var duration = random(500, 800);
    
    log("左滑翻页: 从" + Math.floor(startX) + "到" + Math.floor(endX) + ", 时长: " + duration + "ms");
    
    // 使用标准swipe函数（不使用曲线，确保稳定性）
    swipe(startX, y, endX, y, duration);
}

// ==================== 底部检测 ====================

/**
 * 检测是否到达页面底部
 * 
 * 检测方式：
 * 1. 图片相似度对比（滑动前后截图对比）
 * 2. 底部阴影检测
 * 3. 滚动条位置检测
 * 
 * @param {Object} beforeImg - 滑动前截图
 * @param {Object} afterImg - 滑动后截图
 * @returns {Object} {isBottom: boolean, reasons: array} 是否到达底部及触发的规则
 */
function isAtBottom(beforeImg, afterImg) {
    var reasons = [];
    
    // 方法1：图片相似度对比
    var similarity = getSimilarity(beforeImg, afterImg);
    log("图片相似度: " + (similarity * 100).toFixed(2) + "%");
    if (similarity > similarityThreshold) {
        reasons.push("图片相似度>" + (similarityThreshold * 100) + "%");
    }
    
    // 方法2：检测底部阴影
    var hasShadow = detectBottomShadow();
    log("底部阴影检测: " + (hasShadow ? "是" : "否"));
    if (hasShadow) {
        reasons.push("底部阴影");
    }
    
    // 方法3：检测滚动条位置
    var scrollBarAtBottom = checkScrollBarPosition();
    log("滚动条位置检测: " + (scrollBarAtBottom ? "在底部" : "不在底部"));
    if (scrollBarAtBottom) {
        reasons.push("滚动条在底部");
    }

    // 输出检测结果
    if (reasons.length > 0) {
        log("底部检测结论: 已到达底部，触发规则=[" + reasons.join(", ") + "]");
    } else {
        log("底部检测结论: 未到达底部");
    }

    // 任一条件满足即判定为到达底部
    return {
        isBottom: reasons.length > 0,
        reasons: reasons
    };
}

/**
 * 计算两张图片的相似度
 * 
 * 方法：采样对比法
 * 1. 从图片中央裁剪一个小区域
 * 2. 对比该区域内像素的颜色差异
 * 3. 计算平均差异，转换为相似度
 * 
 * @param {Object} img1 - 图片1
 * @param {Object} img2 - 图片2
 * @returns {number} 相似度（0-1之间，1表示完全相同）
 */
function getSimilarity(img1, img2) {
    if (!img1 || !img2) return 0;

    try {
        // 定义采样区域（屏幕中央1/10区域）
        var sampleWidth = Math.floor(screenWidth / 10);
        var sampleHeight = Math.floor(screenHeight / 10);
        var sampleX = Math.floor(screenWidth / 2 - sampleWidth / 2);
        var sampleY = Math.floor(screenHeight / 2 - sampleHeight / 2);

        // 裁剪采样区域
        var region1 = images.clip(img1, sampleX, sampleY, sampleWidth, sampleHeight);
        var region2 = images.clip(img2, sampleX, sampleY, sampleWidth, sampleHeight);

        var diff = 0;
        var total = sampleWidth * sampleHeight;

        // 对比采样区域内像素（每隔5个像素采样一次）
        for (var x = 0; x < sampleWidth; x += 5) {
            for (var y = 0; y < sampleHeight; y += 5) {
                var color1 = images.pixel(region1, x, y);
                var color2 = images.pixel(region2, x, y);

                // 提取RGB分量
                var r1 = colors.red(color1);
                var g1 = colors.green(color1);
                var b1 = colors.blue(color1);
                var r2 = colors.red(color2);
                var g2 = colors.green(color2);
                var b2 = colors.blue(color2);

                // 计算颜色差异
                diff += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            }
        }

        // 释放图片资源
        if (region1 && region1.recycle) region1.recycle();
        if (region2 && region2.recycle) region2.recycle();

        // 计算平均差异并转换为相似度
        var avgDiff = diff / (total / 25) / 3 / 255;
        return 1 - avgDiff;

    } catch (e) {
        log("相似度计算错误: " + e.toString());
        return 0;
    }
}

/**
 * 检测底部阴影
 * 
 * 原理：到达底部时，继续滑动会在底部产生阴影效果
 * 方法：检测底部区域是否有大量深色像素
 * 
 * @returns {boolean} 是否检测到底部阴影
 */
function detectBottomShadow() {
    try {
        var img = captureScreen();
        if (!img) return false;

        // 检测区域：屏幕底部95%位置
        var bottomY = screenHeight * 0.95;
        var checkWidth = screenWidth * 0.8;
        var startX = screenWidth * 0.1;

        var darkPixels = 0;
        var totalPixels = 0;

        // 检测底部区域的像素颜色
        for (var x = startX; x < startX + checkWidth; x += 10) {
            var color = images.pixel(img, Math.floor(x), Math.floor(bottomY));
            var r = colors.red(color);
            var g = colors.green(color);
            var b = colors.blue(color);

            // 统计深色像素（RGB都小于50）
            if (r < 50 && g < 50 && b < 50) {
                darkPixels++;
            }
            totalPixels++;
        }

        // 释放图片资源
        if (img && img.recycle) img.recycle();

        // 如果深色像素占比超过30%，判定为有阴影
        return darkPixels / totalPixels > 0.3;

    } catch (e) {
        log("阴影检测错误: " + e.toString());
        return false;
    }
}

/**
 * 检测滚动条位置
 * 
 * 原理：到达底部时，滚动条滑块会处于底部位置
 * 方法：检测右侧滚动条滑块是否在底部区域
 * 
 * @returns {boolean} 滚动条是否在底部
 */
function checkScrollBarPosition() {
    try {
        var img = captureScreen();
        if (!img) return false;

        var scrollBarX = screenWidth - 20;
        var scrollBarTop = screenHeight * 0.1;
        var scrollBarBottom = screenHeight * 0.9;

        var scrollBarColor = -1;
        var foundScrollBar = false;

        for (var y = scrollBarTop; y < scrollBarBottom; y += 5) {
            var color = images.pixel(img, Math.floor(scrollBarX), Math.floor(y));
            var r = colors.red(color);
            var g = colors.green(color);
            var b = colors.blue(color);

            var maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            if (maxDiff < 30 && r > 100 && r < 220) {
                if (!foundScrollBar) {
                    scrollBarColor = color;
                    foundScrollBar = true;
                }
            }
        }

        var isAtBottom = false;
        if (foundScrollBar) {
            var bottomRegion = screenHeight * 0.8;
            for (var y = bottomRegion; y < screenHeight; y += 5) {
                var color = images.pixel(img, Math.floor(scrollBarX), Math.floor(y));
                if (Math.abs(color - scrollBarColor) < 100) {
                    isAtBottom = true;
                    break;
                }
            }
        }

        if (img && img.recycle) img.recycle();

        return isAtBottom;

    } catch (e) {
        log("滚动条检测错误: " + e.toString());
        return false;
    }
}



// ==================== 事件处理 ====================

/**
 * 脚本退出事件处理
 */
events.on("exit", function() {
    isRunning = false;
    if (window) {
        window.close();
    }
    toast("脚本已退出");
});

// 保持脚本运行
setInterval(function() {}, 1000);
