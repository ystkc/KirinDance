// canvas层叠顺序从上到下：passiveCanvas, canvas, skeletonCanvas(可与img或video共用)
const debug = false;
const radiusToDegree = 180 / Math.PI;
class Track {
  // 关节跟踪类
  // 以下的“两个节点之间”指：符合上述条件后才会标记产生下一个节点
  // I类节点：间距超过minNodesSpacingI，且速度小于maxSpeed时放置一个
  static minNodesSpacingI = 60; // 两个I类节点之间的最小间距
  static maxSpeed = 40; // 任意I类节点所在位置的最大速度
  // II类节点：间距超过minNodesSpacingII，且两者方向角度之差绝对值大于minAngleAbs时放置一个
  static minNodesSpacingII = 40; // 两个II类节点之间的最小间距
  static minAngleAbs = 150; // 两个II类节点的方向之间的最小角度绝对值
  static detailNodesSeparation = 2; // 每detailNodesSeperation帧产生一个detail节点
  typeToColor = (type) => {
    switch (type) {
      case -1:
        return "rgba(135, 206, 250, 0.9)"; // 天蓝87ceeb99 起点节点
      case 0:
        return "rgba(128, 255, 208, 0.9)"; // #7fffd499 青色 I类节点
      case 1:
        return "rgba(255, 192, 203, 0.9)"; // #ffc0cb99 粉色 II类节点
      case -99:
        return "rgba(192, 192, 192, 0.8)"; // #c0c0c099 浅灰色，录制模式(active)关节运动轨迹，在部分现代浏览器中有水墨stroke效果
      case -98:
        return "rgba(64, 64, 64, 0.1)";
      case 99:
        return "rgba(245, 222, 179, 0.8)"; // f5deb399 麦色，评分模式(passive)关节运动轨迹
    }
  };
  loadConfig(outputConfig) {
    // 配置详情见camera.mjs的guiState定义
    this.showStandardTrack = outputConfig.showStandardTrack; // 显示标准轨迹
    this.showUserTrack = outputConfig.showUserTrack; // 显示用户轨迹
    this.showStandardNodes = outputConfig.showStandardNodes; // 显示标准节点
    this.showUserNodes = outputConfig.showUserNodes; // 显示用户节点
    this.showScore = outputConfig.showScore; // 在每段用户轨迹的中部显示评分
  }
  constructor(ctx, nodeCtx, passiveCtx, outputConfig) {
    // 加载配置
    this.loadConfig(outputConfig);
    // 初始化绘制样式
    this.ctx = ctx;
    this.ctx.lineWidth = 8;
    this.ctx.lineCap = "round";
    this.ctx.strokeStyle = this.typeToColor(-99); // passive+active画笔颜色

    this.nodeCtx = nodeCtx; // 节点抓用画布，比轨迹粗一点
    this.nodeCtx.lineWidth = 12; 

    this.passiveCtx = passiveCtx;
    this.passiveCtx.lineWidth = 8;
    this.passiveCtx.lineCap = "round";
    this.passiveCtx.font = "20px Arial";
    this.passiveCtx.fillStyle = "rgba(0, 0.5)";
    this.passiveCtx.strokeStyle = this.typeToColor(99); // passive画笔颜色

    this.isDrawing = false; // 是否调用了startDrawing（未调用前，其他几个方法将被禁用）否则画笔将无法绘制轨迹
    this.major = false; // 记录当前关节在当前动作段中是否是主要关节（决定是否绘制轨迹）
    this.nodes = []; // 存储节点坐标的数组
    this.detailNodes = []; // 存储详细(detail)节点坐标的数组
    this.standardNodes = []; // (评分模式)标准轨迹的节点坐标数组
    this.standardDetailNodes = []; // (评分模式)标准轨迹的详细轨迹数组
    this.standardNodesCnt = 0; // (评分模式)标准轨迹的节点数量
    this.standardDetailCnt = 0; // (评分模式)标准轨迹的详细轨迹数量
    this.score = []; // 标准轨迹和用户轨迹对比得分
    this.lastPos = { x: 0, y: 0 }; // 记录上一次位置
    this.lastPos2 = { x: 0, y: 0 }; // 记录上上次位置
    this.lastSpeedCheck = 0; // 记录距离上一次速度检查，也就是上一个detail节点的帧数量
    this.lastSpeedPos = { x: 0, y: 0, time: 0 }; // 记录上一次速度检查的位置和时间
    this.strokeSpeed = 0; // 当前画笔速度
    this.angle = 0; // 当前画笔方向角度
    this.progress = 0; // Standard绘制进度(index)
    this.nodeProgress = 0; // StandardNodes绘制进度(index)
    this.startTime = 0; // 评分模式 开始时间
    // this.detailProgress = 0; // 回放模式下detail绘制进度(index)
    // reviewNodesIndex = 0; // 回放模式下上一个节点索引
  }

  setMajor(isMajor) {
    this.isMajor = isMajor; // 记录当前关节在当前动作段中是否是主要关节（决定是否绘制轨迹）
  }

  startDrawing = (e, timestamp) => {
    this.isDrawing = true;
    let currentTime = 0;
    if (typeof timestamp === "undefined") currentTime = Date.now();
    else currentTime = timestamp - this.startTime;
    this.startTime = currentTime;
  };

  draw = (e, timestamp) => {
    // 绘制录制轨迹并解算速度和方向角度，并添加节点
    if (this.standardNodesCnt !== 0) {
      // 评分模式，当前函数会被禁用
      return this.passiveDraw(e, timestamp);
    }

    if (!this.isDrawing) return null; // 没有开始录制或者评分，禁用绘制

    const currentX = e.offsetX;
    const currentY = e.offsetY;
    if (currentX === this.lastPos.x && currentY === this.lastPos.y) return null; // 位置相同，不处理

    let currentTime = 0;
    if (typeof timestamp === "undefined")
      currentTime = Date.now() - this.startTime;
    else currentTime = timestamp - this.startTime;

    // 创建detail节点并绘制轨迹
    this.lastSpeedCheck++;
    if (this.lastSpeedCheck > Track.detailNodesSeparation) {
      // 注意这个参数：过大会导致切分点不准，过小会消耗过多性能产生更多detail点
      this.lastSpeedCheck = 0;
      // 绘制基础轨迹
      if (this.showStandardTrack && this.isMajor) {
        this.ctx.moveTo(this.lastSpeedPos.x, this.lastSpeedPos.y);
        this.ctx.lineTo(currentX, currentY); // stroke由Action类统一调用
      }
      this.calcSpeedAndAngle(currentX, currentY, currentTime);
    }

    // 节点绘制逻辑
    let manhattanDist = 0;
    let nodesIndex = null;
    if (this.nodes.length < 2) {
      // 第一个节点
      this.nodes.push({
        x: currentX,
        y: currentY,
        type: -1,
        time: currentTime,
        detailIndex: 0,
        prevDetailIndex: 0,
      });
      if (this.showStandardNodes)
        this.drawNode(currentX, currentY, this.typeToColor(-1));
      nodesIndex = this.nodes.length - 1;
    } else {
      const lastNode = this.nodes[this.nodes.length - 1];
      // const lastNode2 = this.nodes[this.nodes.length - 2];
      manhattanDist =
        Math.abs(currentX - lastNode.x) + Math.abs(currentY - lastNode.y);

      // 条件判断
      if (
        manhattanDist > Track.minNodesSpacingI &&
        this.strokeSpeed <= Track.maxSpeed
      ) {
        // I类节点
        this.nodes.push({
          x: this.lastPos2.x,
          y: this.lastPos2.y,
          type: 0,
          time: currentTime,
          detailIndex: this.detailNodes.length, // 记录当前节点的第一个detail节点索引
          prevDetailIndex: lastNode.detailIndex, // 记录上一个节点的第一个detail节点索引
        });
        if (this.showStandardNodes)
          this.drawNode(this.lastPos2.x, this.lastPos2.y, this.typeToColor(0));
        this.lastSpeedCheck = 0; // 防止一个节点附近连续出现多个detail节点（detail节点距离过小，容易出现测量错误）
        this.angle = 0;
        this.strokeSpeed = 9999;
        nodesIndex = this.nodes.length - 1;
      } else if (
        manhattanDist > Track.minNodesSpacingII &&
        (this.angle > Track.minAngleAbs || -this.angle > Track.minAngleAbs)
      ) {
        // II类节点
        this.nodes.push({
          x: this.lastPos2.x,
          y: this.lastPos2.y,
          type: 1,
          time: currentTime,
          detailIndex: this.detailNodes.length,
          prevDetailIndex: lastNode.detailIndex,
        });
        if (this.showStandardNodes)
          this.drawNode(this.lastPos2.x, this.lastPos2.y, this.typeToColor(1));
        this.lastSpeedCheck = 0;
        this.angle = 0;
        this.strokeSpeed = 9999;
        nodesIndex = this.nodes.length - 1;
      }
    }

    // 更新位置记录
    this.lastPos2 = this.lastPos;
    this.lastPos = { x: currentX, y: currentY };
    return { index: nodesIndex, distance: manhattanDist };
  };
  pushData = (standardData) => {
    // 传入标准数据
    const { nodes, detailNodes } = standardData;
    this.standardNodes = nodes;
    this.standardDetailNodes = detailNodes;
    this.standardNodesCnt = nodes.length;
    this.standardDetailCnt = detailNodes.length;
  };
  popData = () => {
    this.standardNodes = [];
    this.standardDetailNodes = [];
    this.standardNodesCnt = 0;
    this.standardDetailCnt = 0;
    this.score = [];
  };
  passiveDraw = (e, timestamp) => {
    // 和draw功能相同，但节点是由pushData传入的数据决定（而不是由e决定）

    let score = 0;

    if (
      !this.isDrawing ||
      this.progress >= this.standardDetailCnt ||
      this.nodeProgress >= this.standardNodesCnt
    )
      // 已经结束了
      return score;

    if (e.offsetX === null || e.offsetY === null) {
      if (this.lastPos.x === 0 || this.lastPos.y === 0) return score; // 该关节没有出现过
      e = { offsetX: this.lastPos.x, offsetY: this.lastPos.y };
      console.log(this.lastPos.x, this.lastPos.y);
     } // 与录制模式不同，评分模式即便用户没有动作也还是要绘制标准轨迹
    const currentX = e.offsetX;
    const currentY = e.offsetY;

    let currentTime = 0;
    if (typeof timestamp === "undefined")
      currentTime = Date.now() - this.startTime;
    else currentTime = timestamp - this.startTime;

    while (currentTime > this.standardDetailNodes[this.progress].time) {
      this.detailNodes.push({
        x: currentX,
        y: currentY,
        time: currentTime,
      });
      const pstdn = this.standardDetailNodes[this.progress - 1]; // previous standard detail node
      this.progress++;
      if (this.progress == this.standardDetailCnt) return score; // 评分结束
      const cstdn = this.standardDetailNodes[this.progress]; // current standard detail node

      // 只有最主要的关节才能绘制，否则会变成一坨
      if (this.isMajor) {
        // 绘制标准轨迹
        if (this.showStandardTrack) {
          this.ctx.moveTo(pstdn.x, pstdn.y);
          this.ctx.lineTo(cstdn.x, cstdn.y); // stroke由Action类统一调用
        }
        // 绘制用户轨迹
        if (this.showUserTrack && this.lastPos.x && this.lastPos.y) {
          this.passiveCtx.moveTo(this.lastPos.x, this.lastPos.y);
          this.passiveCtx.lineTo(currentX, currentY); // stroke由Action类统一调用
        }
        this.lastPos = { x: currentX, y: currentY }; // 评分模式的lastPos特指上一个detail节点的位置，相当于录制模式的lastSpeedPos
      }
    }

    let cstn = this.standardNodes[this.nodeProgress]; // current standard node
    while (currentTime > cstn.time) {
      // 计算上一段的残差平方和作为分数储存（消除起点偏移）
      this.nodes.push({
        x: currentX,
        y: currentY,
        type: cstn.type,
        time: currentTime,
      });
      // 计算score
      if (cstn.detailIndex > cstn.prevDetailIndex) {
        // 起点处两个节点之间的detail节点数为0，不能计算分数
        const deltaX =
          this.standardDetailNodes[cstn.prevDetailIndex].x -
          this.detailNodes[cstn.prevDetailIndex].x;
        const deltaY =
          this.standardDetailNodes[cstn.prevDetailIndex].y -
          this.detailNodes[cstn.prevDetailIndex].y; // 标准轨迹和用户轨迹起点的差距（要消除起点差距再评分）
        let relativeX = 0,
          relativeY = 0;

        for (let i = cstn.prevDetailIndex; i < cstn.detailIndex; i++) {
          relativeX =
            this.standardDetailNodes[i].x - this.detailNodes[i].x - deltaX;
          relativeY =
            this.standardDetailNodes[i].y - this.detailNodes[i].y - deltaY;
          score += Math.abs(relativeX) + Math.abs(relativeY); // 用relativeX ** 2 + relativeY ** 2就是残差平方和，此处节省计算量
        }
        score = parseInt(
          Math.max(
            100 - score / 2 / (cstn.detailIndex - cstn.prevDetailIndex),
            0
          )
        );
        // 除以节点数量，防止标准轨迹长度过长导致分数过低（或反之亦然）
      } else score = 0; // 起点节点不计算分数
      this.score[this.nodeProgress] = score;
      if (this.showUserNodes) {
        this.drawNode(currentX, currentY, this.typeToColor(99)); // 绘制用户轨迹节点
      }
      // 绘制分数
      const midPoint =
        this.detailNodes[(cstn.detailIndex + cstn.prevDetailIndex) >> 1]; // 上一段的中点

      if (this.showScore && this.nodeProgress > 1) {
        // 跳过第一段起点节点的分数绘制
        // 将分数打印在passiveCtx的上一段轨迹的中间
        this.passiveCtx.moveTo(midPoint.x, midPoint.y);
        this.passiveCtx.fillText(score, midPoint.x - 10, midPoint.y - 10); // fillText立即生效，不会影响线条渲染
      }
      this.nodeProgress++;
      if (this.nodeProgress >= this.standardNodesCnt) return score;
      cstn = this.standardNodes[this.nodeProgress]; // 画出下一段的标准节点
      if (this.showStandardNodes) {
        this.drawNode(cstn.x, cstn.y, this.typeToColor(cstn.type));
      }
    }
    return score;
  };

  calcSpeedAndAngle = (currentX, currentY, currentTime) => {
    // 速度计算
    if (this.lastSpeedPos.time === 0) {
      this.lastSpeedPos = { x: currentX, y: currentY, time: currentTime };
    }
    this.strokeSpeed = (
      ((Math.abs(currentX - this.lastSpeedPos.x) +
        Math.abs(currentY - this.lastSpeedPos.y)) /
        (currentTime - this.lastSpeedPos.time)) *
      1000
    ).toFixed(2);

    // 角度计算
    // 计算偏移向量
    const prevNode = this.nodes[this.nodes.length - 1];
    const prevVector = {
      x: currentX - prevNode.x,
      y: currentY - prevNode.y,
    };
    const currentVector = {
      x: currentX - this.lastSpeedPos.x,
      y: currentY - this.lastSpeedPos.y,
    };

    // 计算向量夹角
    const dotProduct =
      prevVector.x * currentVector.x + prevVector.y * currentVector.y;
    const magPrevSquare = prevVector.x ** 2 + prevVector.y ** 2;
    const magCurrentSquare = currentVector.x ** 2 + currentVector.y ** 2;
    this.angle =
      Math.acos(dotProduct / Math.sqrt(magPrevSquare * magCurrentSquare)) *
      radiusToDegree;

    this.detailNodes.push({
      // 创建一个detail节点
      x: this.lastSpeedPos.x,
      y: this.lastSpeedPos.y,
      time: currentTime,
    });
    this.lastSpeedPos = { x: currentX, y: currentY, time: currentTime }; // 计算上一次调用本函数的位置和时间
  };

  drawNode = (x, y, color = "rgba(0, 0, 0, 0.5)") => {
    // 绘制节点（一个较大的实心圆点）
    this.nodeCtx.beginPath();
    // this.nodeCtx.moveTo(x, y);
    this.nodeCtx.arc(x, y, 12, 0, Math.PI * 2); // 30px直径
    this.nodeCtx.fillStyle = color;
    this.nodeCtx.fill();
  };

  endDrawing = (timestamp) => {
    if (!this.isDrawing) return; // 没有调用开始绘制时，本函数将被禁用
    this.draw(
      { offsetX: this.lastPos.x + 1, offsetY: this.lastPos.y + 1 },
      timestamp
    ); // 处理最后一段数据
    this.isDrawing = false; // 防止重复调用结束函数

    // 储存结果
    this.result = {
      nodes: this.nodes.slice(1),
      detailNodes: this.detailNodes,
      score: this.score,
    };

    // 清理
    this.lastPos = { x: 0, y: 0 };
    this.lastPos2 = { x: 0, y: 0 };
    this.lastSpeedPos = { x: 0, y: 0, time: 0 };
    this.lastSpeedCheck = 0;
    this.progress = 0;
    this.nodeProgress = 0;
    this.startTime = 0;
    this.nodes = [];
    this.detailNodes = [];
    this.score = [];
  };
}
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
16	rightAnkle

5, 6, leftShoulder-rightShoulder
5, 7, leftShoulder-leftElbow
5, 11, leftShoulder-leftHip
7, 9, leftElbow-leftWrist
6, 8, rightShoulder-rightElbow
6, 12, rightShoulder-rightHip
8, 10, rightElbow-rightWrist
11, 13, leftHip-leftKnee
13, 15, leftKnee-leftAnkle
12, 14, rightHip-rightKnee
14, 16, rightKnee-rightAnkle
11, 12 leftHip-rightHip*/
const seg = [
  // 关节连接关系，两两链接
  5, 6, 5, 7, 5, 11, 7, 9, 6, 8, 6, 12, 8, 10, 11, 13, 13, 15, 12, 14, 14, 16,
  11, 12,
];
const segCnt = 12; // 肢体段数
const pointCnt = 17; // 关节点数
class Action {
  static minActionSpacing = 500; // 动作间最小间隔，ms。小于这个间隔的动作会被合并
  // 动作类，含有一整套关节的Track类对象
  actionTypeToColor = (type) => {
    switch (type) {
      case 0: // 人体连线
        return "rgba(0, 0, 0, 0.5)";
      case 1: // 关节
        return "rgba(238, 130, 238, 0.6)"; // 紫色 ee82ee99
    }
  };
  loadConfig(outputConfig) {
    // 配置详情见camera.mjs的guiState定义
    this.showSkeletons = outputConfig.showSkeletons; // 是否显示骨架
    this.showPoints = outputConfig.showPoints; // 是否显示关键点
  }
  constructor(canvas, nodeCanvas, passiveCanvas, skeletonCanvas, outputConfig) {
    // 载入配置
    this.loadConfig(outputConfig);

    this.accumulatedScore = 0; // 累计得分（所有产生得分的关节的和）
    this.accumulatedTotalScore = 0; // 累计总分（所有产生得分的动作的和）
    this.accumulatedNodesCnt = 0; // 累计产生的分的关节数
    this.progress = 0; // 当前动作的Index

    // 画布配置
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.nodeCanvas = nodeCanvas;
    this.nodeCtx = nodeCanvas.getContext("2d");

    this.passiveCanvas = passiveCanvas;
    this.passiveCtx = passiveCanvas.getContext("2d");

    this.skeletonCanvas = skeletonCanvas;
    this.skeletonCtx = skeletonCanvas.getContext("2d");
    this.skeletonCtx.strokeStyle = this.actionTypeToColor(0);
    this.skeletonCtx.lineWidth = 16;
    this.skeletonCtx.fillStyle = this.actionTypeToColor(1);

    // 一共13个关节trackers
    this.trackers = [
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 0 nose
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 1 leftEye
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 2 rightEye
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 3 leftEar
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 4 rightEar
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 5 leftShoulder
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 6 rightShoulder
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 7 leftElbow
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 8 rightElbow
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 9 leftWrist
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 10 rightWrist
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 11 leftHip
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 12 rightHip
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 13 leftKnee
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 14 rightKnee
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 15 leftAnkle
      new Track(this.ctx, this.nodeCtx, this.passiveCtx, outputConfig), // 16 rightAnkle
    ];
    this.action = []; // 动作数据
    this.prevReviewTime = 0;
  }
  deflateData = (data) => {
    // 对于本类的输出数据压缩可以达到20%的压缩率，还可以使用gzip进一步压缩
    const newAction = [];
    for (const action of data.action) {
      const newTracker = [];
      for (const nodeIndex of Object.keys(action.nodes)) {
        newTracker.push(parseInt(nodeIndex)); // 关节编号
        newTracker.push(action.nodes[nodeIndex].index); // 在关节节点中的索引
        newTracker.push(parseInt(action.nodes[nodeIndex].distance)); // float距离
        newTracker.push(
          action.nodes[nodeIndex].hasOwnProperty("major")
            ? action.nodes[nodeIndex].major
            : 0 // 兼容性考虑
        ); // 是否是关键点
      }
      newTracker.push(action.time); // 相对时间戳，ms
      newAction.push(newTracker);
    }
    const newTresults = []; // new Trackers' results
    for (const tresult of data.tresults) {
      // 每个关节的轨迹数据
      const newNodes = [];
      if (tresult !== undefined)
        for (const node of tresult.nodes) {
          // 关键点
          newNodes.push(parseInt(node.x)); // 坐标
          newNodes.push(parseInt(node.y));
          newNodes.push(node.type); // 置信度
          newNodes.push(node.time); // 相对时间戳，ms
          newNodes.push(node.detailIndex); // 详细轨迹索引
          newNodes.push(node.prevDetailIndex); // 前一个详细轨迹索引
        }
      newTresults.push(newNodes);
      const newDetailNodes = [];
      if (tresult !== undefined)
        for (const detailNode of tresult.detailNodes) {
          // 详细轨迹
          newDetailNodes.push(parseInt(detailNode.x)); // 坐标
          newDetailNodes.push(parseInt(detailNode.y));
          newDetailNodes.push(detailNode.time); // 相对时间戳，ms
        }
      newTresults.push(newDetailNodes);
    }
    return [newAction, newTresults];
  };
  reconstructData = (compressed) => {
    const [compressedAction, compressedTresults] = compressed;
    const data = { action: [], tresults: [] };

    // 还原 action 数据
    for (const compressedTracker of compressedAction) {
      const action = {
        nodes: {},
        time: compressedTracker[compressedTracker.length - 1],
      };
      let index = 0;
      while (index < compressedTracker.length - 1) {
        const nodeIndex = compressedTracker[index++];
        const nodeInnerIndex = compressedTracker[index++];
        const distance = compressedTracker[index++];
        const isMajor = compressedTracker[index++] === 1;
        action.nodes[nodeIndex] = {
          index: nodeInnerIndex,
          distance: distance,
          ...(isMajor ? { major: 1 } : {}), // 兼容性考虑：以前是由0或1表示major，现在是由1表示major
        };
      }
      data.action.push(action);
    }

    // 还原 tresults 数据
    for (let i = 0; i < compressedTresults.length; i += 2) {
      const nodes = [];
      const detailNodes = [];

      const newNodes = compressedTresults[i];
      let index = 0;
      while (index < newNodes.length) {
        const x = newNodes[index++];
        const y = newNodes[index++];
        const type = newNodes[index++];
        const time = newNodes[index++];
        const detailIndex = newNodes[index++];
        const prevDetailIndex = newNodes[index++];
        nodes.push({
          x: x,
          y: y,
          type: type,
          time: time,
          detailIndex: detailIndex,
          prevDetailIndex: prevDetailIndex,
        });
      }

      const newDetailNodes = compressedTresults[i + 1];
      index = 0;
      while (index < newDetailNodes.length) {
        const x = newDetailNodes[index++];
        const y = newDetailNodes[index++];
        const time = newDetailNodes[index++];
        detailNodes.push({ x: x, y: y, time: time });
      }
      data.tresults.push({ nodes: nodes, detailNodes: detailNodes });
    }

    return data;
  };

  pushData = (poseData) => {
    // 结构：{actions, tresults}
    const { action, tresults } = this.reconstructData(poseData);
    this.standardActions = action;
    this.standardActionsCnt = action.length;
    for (let i = 0; i < tresults.length; i++) {
      if (tresults[i] === null) continue;
      this.trackers[i].pushData(tresults[i]);
    }
  };
  drawSkeletons = (positions) => {
    // 结构: positions{keypoints[{x,y,score}]}
    // 绘制人体骨骼
    if (this.showSkeletons) {
      this.skeletonCtx.beginPath();
      for (let i = 0; i < segCnt; i++) {
        // 遍历每一段肢体
        const start = seg[i << 1]; // 开始关节
        const end = seg[(i << 1) | 1]; // 结束关节
        if (
          positions[start].offsetX === null ||
          positions[end].offsetX === null
        )
          continue; // 有其中一个关节没有出现，这一段肢体不画
        this.skeletonCtx.moveTo(
          positions[start].offsetX,
          positions[start].offsetY
        );
        this.skeletonCtx.lineTo(positions[end].offsetX, positions[end].offsetY);
      }
      this.skeletonCtx.stroke();
    }
    // 绘制关节
    if (this.showPoints) {
      this.skeletonCtx.beginPath();
      for (let i = 0; i < positions.length; i++) {
        if ((i > 0 && i < 5) || positions[i].offsetX === null) {
          continue; // 头部不画左右眼、左右耳，只画鼻子
        }
        const pox = positions[i].offsetX;
        const poy = positions[i].offsetY;
        // 避免圆点之间被填充
        this.skeletonCtx.moveTo(
          pox,
          poy
        );
        // 绘制圆点
        this.skeletonCtx.arc(
          pox,
          poy,
          16,
          0,
          Math.PI * 2
        );
      }
      this.skeletonCtx.fill();
    }
  };
  startDrawing = (pose, timestamp) => {
    this.isDrawing = true;
    this.startTime = timestamp;
    // PosNet:
    // const position = pose.keypoints.map((keypoint) => ({
    //   x: keypoint.position.x,
    //   y: keypoint.position.y,
    // }));
    // MoveNet:
    const position = pose.keypoints.map((keypoint) => ({
      x: keypoint.x,
      y: keypoint.y,
    }));
    for (let i = 0; i < this.trackers.length; i++) {
      this.trackers[i].startDrawing(position[i], timestamp);
    }
  };
  setMajor = (actionNodes) => {
    for (let index=0; index<pointCnt; index++) {
      if (!(index in actionNodes)) {
        this.trackers[index].setMajor(false); // 没有节点的关节：不标记为major
        continue;
      }
      const nodeInfo = actionNodes[index];
      this.trackers[index].setMajor(
        nodeInfo.hasOwnProperty("major")
          ? nodeInfo.major // 兼容性考虑
          : false
      );
    }

  };
  markMajor = (actionNodes) => {
    // 将actionNodes中距离d最大的1个节点标记为major节点
    let maxD = 0,
      maxI = null;
    for (const index of Object.keys(actionNodes)) {
      if (actionNodes[index].distance > maxD) {
        maxD = actionNodes[index].distance; // 最大运动距离
        maxI = index; // 最大运动距离对应节点序号
      }
      // 如果有多个major节点，则只标记一个。因此先将所有major标签去除
      if (actionNodes[index].hasOwnProperty("major"))
        delete actionNodes[index].major;
    }
    if (maxI !== null) actionNodes[maxI].major = 1; // 用hasOwnProperty判断major节点。如果是null说明全0，不标记
  };
  draw = (pose, timestamp) => {
    // 录制模式
    let score = null; // null表示没有Tracker返回了分数

    const positions = pose.keypoints.map((keypoint) => ({
      offsetX: keypoint.position.x,
      offsetY: keypoint.position.y,
    })); // 将MoveNet输出的坐标信息(position.x, position.y)转化为事件坐标信息(OffsetX, OffsetY)
    this.drawSkeletons(positions);

    const actionNodes = {}; // 当前帧有哪些关节生成了节点
    let actionNodesCnt = 0; // 当前帧有多少个关节生成了节点
    for (let i = 0; i < positions.length; i++) {
      // if (i!== 0)continue; // 测试
      if ((i > 0 && i < 5) || positions[i].offsetX === null) {
        // 头部不考虑左右眼、左右耳，只考虑鼻子
        // 外部已经将置信度过低的节点替换成null
        continue;
      }
      const nodesInfo = this.trackers[i].draw(positions[i], timestamp); // 包含节点类型index和距离上一节点的距离distance
      if (nodesInfo !== null && nodesInfo.index !== null)
        // 该关节在本帧返回了有效节点
        (actionNodes[i] = nodesInfo), actionNodesCnt++; // 记录该关节产生了节点
    }
    this.ctx.stroke();
    this.ctx.beginPath();
    this.passiveCtx.stroke();
    this.passiveCtx.beginPath(); // 为提升性能，全部只统一渲染一次
    if (actionNodesCnt === 0) return null; // 没有任何节点生成，返回null
    // 遇到了动作节点
    if (timestamp - this.lastActionTime < Action.minActionSpacing) {
      // 短时间内有很多关节生成了节点，合并
      // ms，如果是frame需要调参
      const prevActionNodes = this.action[this.action.length - 1].nodes; // 上一个动作的节点
      // 动作节点连续，合并(无需处理tracker逻辑，零碎节点误判不会影响动作回放)
      for (const nodes of Object.keys(actionNodes))
        if (!prevActionNodes.hasOwnProperty(nodes))
          // 如果上一个动作也有这个关节的节点，则覆盖为新的节点
          prevActionNodes[nodes] = actionNodes[nodes];
      this.markMajor(prevActionNodes); // 合并后重新标记major节点
      this.setMajor(prevActionNodes);
      this.action[this.action.length - 1].nodes = prevActionNodes;
      this.action[this.action.length - 1].time = timestamp - this.startTime; // 更新时间戳
    } else {
      // 每个动作清空一次ctx和passiveCtx，避免过于混乱
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.passiveCtx.clearRect(
        0,
        0,
        this.passiveCanvas.width,
        this.passiveCanvas.height
      ); // 一般情况clearRect要和beginPath一起使用，但是上面使用过了，此处省略
      this.markMajor(actionNodes);
      this.setMajor(actionNodes);
      this.action.push({
        // 生成新动作
        nodes: actionNodes,
        time: timestamp - this.startTime,
      });
    }
    this.lastActionTime = timestamp; // 标记上次动作时间，用于合并
    return score;
  };
  passiveDraw = (pose, timestamp) => {
    // 回放模式
    let score = 0;
    const positions = pose.keypoints.map((keypoint) => ({
      offsetX: keypoint.position.x,
      offsetY: keypoint.position.y,
    }));
    this.drawSkeletons(positions);
    // 检测positions中是否有0
    for (let i = 0; i < positions.length; i++) {
      if (positions[i].offsetX === 0 && positions[i].offsetY === 0) {
        console.log("检测到0坐标，跳过帧");
        return null;
      }
    }
    // 如果遇到动作节点了，先清屏，然后再处理动作节点，最后才能计算分数
    const currentTime = timestamp - this.startTime;
    const prevProgress = this.progress;
    
    // 处理动作节点
    for (let i = 0; i < this.trackers.length; i++) {
      let subScore = this.trackers[i].passiveDraw(positions[i], timestamp);
      if (subScore !== 0) {
        this.accumulatedScore += subScore;
        this.accumulatedNodesCnt++; // 统计一共有多少个关节产生了分数
      }
    }
    this.ctx.stroke();
    this.ctx.beginPath();
    this.passiveCtx.stroke();
    this.passiveCtx.beginPath(); // 为提升性能，全部只统一渲染一次
    
    // 同步动作的时间轴
    while (
      this.progress < this.standardActionsCnt &&
      currentTime > this.standardActions[this.progress].time
    ) {
      // 同步时间进度
      this.progress++;
    }
    if (this.progress !== prevProgress) {
      // 清屏
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.passiveCtx.clearRect(
        0,
        0,
        this.passiveCanvas.width,
        this.passiveCanvas.height
      );
      this.nodeCtx.clearRect(
        0,
        0,
        this.nodeCanvas.width,
        this.nodeCanvas.height
      ) // 一般情况clearRect要和beginPath一起使用，但是上面使用过了，此处省略
      // 更新major关节
      const currentStandardActionNodes =
        this.standardActions[this.progress - 1].nodes;
      this.setMajor(currentStandardActionNodes);

      // 如果有新的动作了，计算累计的关节的分数
      if (this.accumulatedNodesCnt > 0) {
        score = this.accumulatedScore / this.accumulatedNodesCnt; // 取关节的平均值
        this.accumulatedScore = 0;
        this.accumulatedNodesCnt = 0;
      }
    }
    this.accumulatedTotalScore += score; // 累计总分
    return score;
  };

  endDrawing = (timestamp) => {
    this.isDrawing = false;
    for (let i = 0; i < this.trackers.length; i++) {
      this.trackers[i].endDrawing(timestamp);
    }
    this.lastActionTime = -9999; // 将上一个动作的时间设置为负无穷大，防止新生成的动作与上一个动作合并
    // 导出动作数据
    const tresults = [],
      tscores = [];
    for (const tracker of this.trackers) {
      tresults.push(tracker.result);
      tscores.push(tracker.score);
    }
    // 构造结果
    this.result = {
      action: this.action,
      tresults: tresults,
      tscores: tscores,
    };
    this.action = [];
    console.log(this.deflateData(this.result));
    // 显示最终平均分（this.accumulatedTotalScore/this.standardActionsCnt）
    let finalScore = this.accumulatedTotalScore / this.standardActionsCnt;
    let remark = "";
    if (finalScore > 90) remark = "<br>太强辣！";
    else if (finalScore > 80) remark = "<br>相当不错！";
    else remark = "<br>再接再厉！";
    showModal(
      "您的分数是：" +
        finalScore.toFixed(2) +
        remark +
        "<br>刷新页面开始新一轮评分。",
      "评分结束"
    );
  };
}
class ActionRecorder {
  // 负责记录动作图像，并提供动作回放功能
  constructor(skeletonCanvas) {
    this.skeletonCanvas = skeletonCanvas;
    this.skeletonCtx = skeletonCanvas.getContext("2d");
    this.imgs = [];
    this.imgsLength = 0;
  }
  pushImg = (img) => {
    this.imgs.push(img);
    this.imgsLength++;
    // 绘制
    //   this.skeletonCtx.clearRect(0, 0, this.skeletonCanvas.width, this.skeletonCanvas.height);
    this.skeletonCtx.drawImage(img, 0, 0);
    return this.imgsLength - 1;
  };
  replayImg = (index) => {
    if (index < 0 || index >= this.imgsLength) return;
    //   this.skeletonCtx.clearRect(0, 0, this.skeletonCanvas.width, this.skeletonCanvas.height);
    this.skeletonCtx.drawImage(this.imgs[index], 0, 0);
  };
  clear = () => {
    this.imgs = [];
    this.imgsLength = 0;
    this.skeletonCtx.clearRect(
      0,
      0,
      this.skeletonCanvas.width,
      this.skeletonCanvas.height
    );
  };
  stop = () => {
    this.clear();
  };
}
