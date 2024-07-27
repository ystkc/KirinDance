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
  3,3,//肩膀动作幅度较小，权重大
  1.1,1.1,//手肘动作幅度略小于手臂，权重略大于手臂，但不应比膝盖大
  1,1,//手腕，动作幅度最大，作为权重单位值
  4,4,//髋，动作幅度比肩膀还要小些
  1.2,1.2,// 膝盖
  1,1,//脚踝，动作幅度最大，作为权重单位 值
];
const pose_conflict = [
  [0,1,2,3,4],//头部互相排斥
  [0,1,2,3,4],//头部互相排斥
  [0,1,2,3,4],//头部互相排斥
  [0,1,2,3,4],//头部互相排斥
  [0,1,2,3,4],//头部互相排斥
  [7,9],//左手
  [8,10],//右手
  [5,9],
  [6,10],
  [5,7],
  [6,8],
  [13,15],//左腿
  [14,16],//右腿
  [11,15],
  [12,16],
  [11,13],
  [12,14],
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
   
const threshold = 10;  //权重阈值，小于此值认为动作不明显，单位px
  
  
function updateHistory(positions) {   
    // 暂不处理头部，但是slice(5)会造成后面不好处理
    history.push(positions.map(pos => ({ x: pos.x, y: pos.y, time: new Date().getTime() })));  
}  
  
function drawHistory() {  
    const canvas = document.getElementById('output_mask');  
    const ctx = canvas.getContext('2d');  
    ctx.clearRect(0, 0, canvas.width, canvas.height);  
  
    for (let i = 5; i < 16; i++) {  
        if (jointStates[i]) {  
            const color = i === 10 ? 'blue' : 'green';  
            const points = history.map(frame => ({ x: frame[i].x, y: frame[i].y }));  
            ctx.beginPath();  
            ctx.moveTo(points[0].x, points[0].y);  
            for (let j = 1; j < points.length; j++) {  
                ctx.lineTo(points[j].x, points[j].y);  
            }  
            ctx.closePath();  
            ctx.strokeStyle = color;  
            ctx.stroke();  
        }  
    }  
    history = [];  
}  
  
function updateJointState(pose, currentTime) {  
    // 最后一次的pose可能是undefine，因此需要判断一下
    if (!pose) {  
        return;  
    }
    console.log(pose);
    positions = pose.keypoints.map(keypoint => ({ x: keypoint.position.x, y: keypoint.position.y }));
    if (!lastTime) {  
        lastTime = currentTime;  
        return;  
    }  
  
    const dt = (currentTime - lastTime);
    let allSameDirection = true;  
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
        const angle = Math.atan2(dy, dx) * 180 / dt / Math.PI;  // degree/ms
        if (speed > threshold) {  
            console.log('111111111111111111111');
            console.log(i);
            console.log(speed);
            jointStates[i] = true;  // 关节是否在运动
            jointSpeeds[i] = speed;  // 关节速度
            lastDirections[i] = angle;  // 运动方向，x轴正方向为0°，逆时针为正方向 
            directionSum += angle;  
        } else {  
            jointStates[i] = false;  
        }  
    }  
  
    // Check if all joints are moving in the same direction  
    const avgDirection = directionSum / jointStates.slice(5).filter(Boolean).length;  
    allSameDirection = true;
    for (let i = 5; i < 16; i++) {  
        if (jointStates[i]) {  
            if (Math.abs(lastDirections[i] - avgDirection) > 45) {  
                allSameDirection = false;  
                break;  
            }
        }
        else {
            allSameDirection = false;
            break;
        }
    }  
    if (allSameDirection) {  
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
    // Check continuity  

    let isThisContinuous = true;  
    for (let i = 5; i < 16; i++) {  
        if (jointStates[i] != prevJointStates[i]) {  
            isThisContinuous = false;  
            break;  
        }
        if (jointStates[i])
        {
            if (Math.abs(lastDirections[i]) > 45) {  
                isThisContinuous = false;  
                break;  
            }
            else if (Math.abs(lastDirections[i]) > 30) {  
                // 改变方向小于45°但大于30°时，认为是连续的，记录进入history 
                updateHistory(positions);
            }
        }
    }
  
  // 容错检查
  
    if (!isThisContinuous) {  
        interruptionCount++;  
        if (interruptionCount >= 3) {  
            updateHistory(lastPositions); // Save last known continuous positions  
            drawHistory();  // 在canvas_mask上画出连续动作轨迹  
            updateHistory(positions);  // Save current positions as renewed continuous positions  
            interruptionCount = 0;
        }  
    } else {  
        interruptionCount = 0; // Reset counter on continuity  
        // Update last positions and time  
        lastPositions = positions.slice();  
        lastTime = currentTime;  
        prevJointStates = jointStates.slice();  
        prevLastDirections = lastDirections.slice();  
    }  
}  