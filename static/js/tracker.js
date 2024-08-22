/*Id	Part
0	nose
1	leftEye
2	rightEye
3	leftEar
4	rightEar
5	leftShoulder
6	rightShoulder
7	leftElbow
8	rightElbow
9	leftWrist
10	rightWrist
11	leftHip
12	rightHip
13	leftKnee
14	rightKnee
15	leftAnkle
16	rightAnkle*/

const pose_weight = [
  0,0,0,0,0,//头部暂不检测
  0.2,0.2,//肩膀动作幅度较小，权重大
  1.1,1.1,//手肘动作幅度略小于手臂，权重略大于手臂，但不应比膝盖大
  1,1,//手腕，动作幅度最大，作为权重单位值
  2,2,//髋，动作幅度比肩膀还要小些
  1.2,1.2,// 膝盖
  1,1,//脚踝，动作幅度最大，作为权重单位 值
];
const pose_conflict = [
  [0,1,2,3,4],//头部互相排斥
  [5,7,9],// 左手
  [6,8,10],// 右手
  [11,13,15],// 左腿
  [12,14,16],// 右腿
];

let lastPositions = new Array(16).fill(null).map(() => ({ x: 0, y: 0 }));  
let lastTime = 0;    
let interruptionCount = 0;  
let jointStates = new Array(16).fill(false);  
let prevJointStates = new Array(16).fill(false);  // 记录上一次检测到的关节状态
let lastDirections = new Array(16).fill(0);  
let prevLastDirections = new Array(16).fill(0);  // 记录上一次检测到的运动方向，用于判断是否连续
let jointSpeeds = new Array(16).fill(0);  
let history = [];  //每次检测到明确的动作45°以内切换连续节点就push进去，直到不连续切换时输出并全部弹出
   
const threshold = 0.01;  //权重阈值，小于此值认为动作不明显，单位px
const same_direction_threshold = 20;  // 同方向阈值，大于此值认为是连续动作，单位degree
const minor_changed_direction_threshold = 10;  // 改变方向阈值，小于此值认为是连续动作，单位degree
const incontinuity_thresh = 9;
const incontinuity_time = 500;  // 不连续动作持续时间，单位ms，要两个incontinuity都超过，才判定为不连续动作
  
let bufferPositions = [];
let bufferTime = [];
let bufferStates = [];
let bufferSpeeds = [];
let bufferDirections = [];
const bufferLength = 10;

function initJointState() {
    history = [];
    bufferPositions = [];
    bufferTime = [];
    bufferStates = [];
    bufferSpeeds = [];
    bufferDirections = [];
}
function pushBuffer(positions, time, states, speeds, directions){
    if (bufferPositions.length >= bufferLength) {
        bufferPositions.shift();
        bufferTime.shift();
        bufferStates.shift();
        bufferSpeeds.shift();
        bufferDirections.shift();
    }
    bufferPositions.push(positions);
    bufferTime.push(time);
    bufferStates.push(states);
    bufferSpeeds.push(speeds);
    bufferDirections.push(directions);
    // console.log(bufferPositions.length);
    
}
function getBuffer(){

    // 取buffer的平均值
    const bufferlength = bufferPositions.length;// 所有缓冲区长度是相同的
    if (bufferlength == 0) {
        return;
    }
    
    // bufferPositions中有x、y两个字段
    const avgPositions = bufferPositions.reduce((acc, cur) => acc.map((a, i) => ({ x: (a.x + cur[i].x), y: (a.y + cur[i].y)})), new Array(16).fill({ x: 0, y: 0 })).map(a => ({ x: a.x / bufferlength, y: a.y / bufferlength}));
    const avgTime = bufferTime.reduce((acc, cur) => acc + cur, 0) / bufferlength;
    // 如果有半数以上关键帧认为这个关节在运动，那么true
    const avgStates = bufferStates.reduce((acc, cur) => acc.map((a, i) => a + cur[i]), new Array(16).fill(0)).map(a => (a > bufferlength / 2));
    const avgSpeeds = bufferSpeeds.reduce((acc, cur) => acc.map((a, i) => a + cur[i]), new Array(16).fill(0)).map(a => a / bufferlength);
    const avgDirections = bufferDirections.reduce((acc, cur) => acc.map((a, i) => a + cur[i]), new Array(16).fill(0)).map(a => a / bufferlength);
    const buffer = {

        positions: avgPositions,
        time: avgTime,
        states: avgStates,
        speeds: avgSpeeds,
        directions: avgDirections
    }
    // console.log(buffer);
    // console.log(bufferPositions);
    return buffer;
}


function updateHistory(positions, directions) {   
    // 将positions中每个项与directions合并，然后加入history
    history.push(positions.map((pos, i) => ({...pos, direction: directions[i]})));
}  
function drawArc(ctx, x1, y1, a1, x2, y2, a2) {
    // 先用绿色画出两个点连线
    console.log(x1, y1, a1, x2, y2, a2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();
    // 计算两切点处的圆心连线斜率
    const k1 = -1 / Math.tan(a1 * Math.PI / 180);
    const k2 = -1 / Math.tan(a2 * Math.PI / 180);
    // 求交点坐标(圆心)
    const tx = (y2 - y1 + k1 * x1 - k2 * x2) / (k1 - k2);
    const ty = k1 * (tx - x1) + y1;
    // 求起止角度
    const startAngle = (90 - k1) * Math.PI / 180;
    const endAngle = (90 - k2) * Math.PI / 180;
    
    // 求两条线交点即为圆心
    // const cosStart = Math.abs(Math.cos(startAngle));
    // const sinStart = Math.abs(Math.sin(startAngle));
    // const cosEnd = Math.abs(Math.cos(endAngle));
    // const sinEnd = Math.abs(Math.sin(endAngle));
    // const x = (cosStart * x2 + cosEnd * x1) / (cosStart + cosEnd);
    // const y = (sinStart * y2 + sinEnd * y1) / (sinStart + sinEnd);
    
    // 求半径
    const tr = Math.sqrt((tx - x1) ** 2 + (ty - y1) ** 2);

    const anticlockwise = (k2 - k1) > 0;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, startAngle, endAngle, anticlockwise);
    
    ctx.closePath();  
    ctx.strokeStyle = '#FF00FF66';  
    ctx.lineWidth = 9;  
    ctx.stroke();   
    console.log(`ctx.arc(${tx}, ${ty}, ${tr}, ${startAngle}, ${endAngle}, ${anticlockwise})`);
    // if (tr > 10) {aaa;}
    // 测试代码
    /*
    ctx = document.getElementById('output_mask').getContext('2d');
    ctx.clearRect(0, 0, 500, 500);
    ctx.beginPath();
   
    ctx.closePath();
    ctx.strokeStyle = '#FF00FF66';
    ctx.lineWidth = 9;
    ctx.stroke();
    
    
    */
}
function drawHistory() {  
    const canvas = document.getElementById('output_mask');  
    const ctx = canvas.getContext('2d');  
    ctx.clearRect(0, 0, canvas.width, canvas.height);  
  
    // for (let i = 5; i < 16; i++) {
    let i = 9;{  
        // if (jointStates[i]) {  
            const points = history.map(item => ({ x: item[i].x, y: item[i].y, angle: item[i].direction }));  
             
            // ctx.beginPath();  
            // ctx.moveTo(points[0].x, points[0].y);  
            // for (let j = 1; j < points.length; j++) {  
            //     ctx.lineTo(points[j].x, points[j].y); // —
            //     // 在末端画个箭头
            //     // 计算线段长度
            //     const length = Math.sqrt((points[j].x - points[j-1].x) ** 2 + (points[j].y - points[j-1].y) ** 2);
            //     const portion = 10 / length;
            //     // 找到线段的5分位点
            //     const x_ = points[j].x * (1 - portion) + points[j-1].x * portion;
            //     const y_ = points[j].y * (1 - portion) + points[j-1].y * portion;
            //     ctx.moveTo(x_ - (points[j].y - y_), y_ + (points[j].x - x_));// 箭头两个端点，有全等三角形模型
            //     ctx.lineTo(points[j].x, points[j].y);// ⇀
            //     ctx.lineTo(x_ + (points[j].y - y_), y_ - (points[j].x - x_));// →
            //     ctx.moveTo(points[j].x, points[j].y);
            // }  
            // ctx.closePath();  
            // ctx.strokeStyle = '#00FFFF66';  
            // // 设置粗细
            // ctx.lineWidth = 3;  
            // ctx.stroke();  
            // 画圆弧
            
            for (let j = 1; j < points.length; j++) { 
                drawArc(ctx, points[j-1].x, points[j-1].y, points[j-1].angle, points[j].x, points[j].y, points[j].angle);
                
            }  


        // }  
    }  
}  
  
function updateJointState(pose, currentTime) {  
    // 最后一次的pose可能是undefine，因此需要判断一下
    if (!pose) {  
        return;
    }
    
    positions = pose.keypoints.map(keypoint => ({ x: keypoint.position.x, y: keypoint.position.y }));
    if (bufferPositions.length == 0){
        pushBuffer(positions, currentTime, jointStates, jointSpeeds, lastDirections);
        return;
    }
    buffer = getBuffer();
    console.log(buffer);
    lastPositions = buffer.positions;
    prevJointStates = buffer.states;
    prevLastDirections = buffer.directions;
    lastTime = buffer.time;
    
    if (!lastTime) {  
        return;  
    }  
  
    const dt = (currentTime - lastTime);
    if (dt === 0) {  
        return;  
    }  
  
    // Check if all joints are moving in the same direction  
    let notSameDirection = 0;  
    let directionSum = 0;  
  
    // Calculate speed and angle for each joint  
    // 将jointStates清空
    for (let i = 0; i < 16; i++) {  
        jointStates[i] = false;  
        jointSpeeds[i] = 0;  
        lastDirections[i] = 0;  
    }

    
    for (let i = 5; i < 16; i++) { 
        if (pose.keypoints[i].score < 0.5) {
            continue    
        } 
        const dx = positions[i].x - lastPositions[i].x;  
        const dy = positions[i].y - lastPositions[i].y;  
        const speed = Math.sqrt(dx * dx + dy * dy) / dt * pose_weight[i];  // px/ms
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;  // degree/ms thresh = 100degree/1000ms

        jointSpeeds[i] = speed;  // 关节速度
        lastDirections[i] = angle;  // 运动方向，x轴正方向为0°，逆时针为正方向 
        directionSum += angle;  
        if (speed > threshold) {  
            jointStates[i] = true;  // 关节是否在运动
        } else {  
            jointStates[i] = false;  
        }  
    }  
  
    // Check if all joints are moving in the same direction ，理想状态下所有，但是实际上只要大于8个就行
    const avgDirection = directionSum / jointStates.slice(5).filter(Boolean).length;  
    notSameDirection = 0;
    for (let i = 5; i < 16; i++) {  
        if (jointStates[i]) {  
            if (Math.abs(lastDirections[i] - avgDirection) > same_direction_threshold) {  
                notSameDirection += 1;  
                break;  
            }
        }
    }  
    if (notSameDirection < 4) {  
        jointStates.fill(false);  
        let lowestMoving = -1, maxY = 0;  
        for (let i = 5; i < 16; i++) {  // find the lowest joint that is moving  (y坐标最大)  
            if (jointStates[i] && positions[i].y > maxY) {  
                maxY = positions[i].y;  
                lowestMoving = i - 5;  
            }
        }  

        if (lowestMoving !== -1) {  
            jointStates[lowestMoving + 5] = true;  // Mark the other joints as not moving except for the lowest one  
        }  
    }  
  
    // Remove conflicting joints  （如果挥左手，左肩、左肘、左腕都会动，当左腕加权速度最大时，只需要告诉用户动左腕就行）
    for (let i = 0; i < pose_conflict.length; i++) {  
        const joints = pose_conflict[i];  
        max_speed = 0;  
        max_joint = -1;  
        // Reset the moving state of conflicting joints  
        joints.forEach(j => jointStates[j] = false);  

        for (let j = 0; j < joints.length; j++) {  
            if (jointSpeeds[joints[j]] > max_speed) {  
                max_speed = jointSpeeds[joints[j]];  
                max_joint = j;  
            }  
        }  
        if (max_joint !== -1) {  
            jointStates[joints[max_joint]] = true;  
        }
    }


    console.log(jointStates);
    console.log(jointSpeeds);   
    console.log(lastDirections);


    // Check continuity  
    let isThisContinuous = true;
    let minorChanged = false;
    let movingChanged = false;
    let directionChanged = false;
    
    for (let i = 5; i < 16; i++) {  
        if (jointStates[i] != prevJointStates[i]) {  
            isThisContinuous = false;  
            movingChanged = true;
            break;  
        }
        if (jointStates[i])
        {
            if (Math.abs(lastDirections[i] - prevLastDirections[i]) > same_direction_threshold) {  
                isThisContinuous = false;
                directionChanged = true;
                break;  
            }
            else if (Math.abs(lastDirections[i] - prevLastDirections[i]) > minor_changed_direction_threshold) {  
                // 改变方向小于45°但大于30°时，认为是连续的，记录进入history 
                minorChanged = true;  
                break;
            }
        }
    }
  
  // 容错检查
    
    if (minorChanged)
    {
        updateHistory(positions, lastDirections);
        drawHistory();
    }
    document.getElementById('test').textContent = '---';
    if (!isThisContinuous) {  
        interruptionCount++;  
        if (interruptionCount >= incontinuity_thresh && dt > incontinuity_time) { 
            if (movingChanged){
                document.getElementById('test') .textContent = '动作变化';
            }
            else if (directionChanged){
                document.getElementById('test') .textContent = '方向变化';
            }
            updateHistory(lastPositions, lastDirections); // Save last known continuous positions  
            drawHistory();  // 在canvas_mask上画出连续动作轨迹  
            history = [];
            updateHistory(lastPositions, lastDirections);  // Save current positions as renewed continuous positions  
            interruptionCount = 0;
        }  
    } else {  
        interruptionCount = 0; // Reset counter on continuity  
        // Update last positions and time  
    }  
    pushBuffer(positions, currentTime, jointStates, jointSpeeds, lastDirections);
}  