// canvas层叠顺序从上到下：passiveCanvas, canvas, skeletonCanvas(可与img或video共用)
const debug = false;
class Track {
  static minNodesSpacingI = 50;
  static minNodesSpacingII = 50;
  static minAngleAbs = 45;
  static maxSpeed = 30;
  static detailNodesSeparation = 2;
  typeToColor = (type) => {
    switch (type) {
      case -1:
        return "rgba(135, 206, 250, 0.5)"; // 天蓝87ceeb99
      case 0:
        return "rgba(128, 255, 208, 0.5)"; // #7fffd499 青色
      case 1:
        return "rgba(255, 192, 203, 0.5)"; // #ffc0cb99 粉色
      case -99:
        return "rgba(192, 192, 192, 0.1)"; // #c0c0c099 浅灰色，active，在部分现代浏览器中有水墨stroke效果
      case -98:
        return "rgba(64, 64, 64, 0.1)";
      case 99:
        return "rgba(245, 222, 179, 0.5)"; // f5deb399 麦色，passive
    }
  };
  constructor(ctx, passiveCtx) {
    this.ctx = ctx;
    this.passiveCtx = passiveCtx;
    this.isDrawing = false;
    this.onNode = false;
    this.nodes = []; // 存储节点坐标的数组
    this.detailNodes = []; // 存储详细轨迹的数组
    this.standardNodes = []; // 标准轨迹的节点坐标数组
    this.standardDetailNodes = []; // 标准轨迹的详细轨迹数组
    this.standardNodesCnt = 0;
    this.standardDetailCnt = 0;
    this.score = []; // 标准轨迹和用户轨迹对比得分
    this.lastPos = { x: 0, y: 0 }; // 记录上一次位置
    this.lastPos2 = { x: 0, y: 0 }; // 记录上上次位置
    this.lastSpeedCheck = 0; // 记录距离上一次速度检查的move数量
    this.lastSpeedPos = { x: 0, y: 0, time: 0 }; // 记录上一次速度检查的位置和时间
    this.strokeSpeed = 0; // 当前画笔速度
    this.angle = 0; // 当前画笔角度
    this.progress = 0; // Standard绘制进度(index)
    this.nodeProgress = 0; // StandardNodes绘制进度(index)
    this.startTime = 0; // Passive开始时间
    this.detailProgress = 0; // Review模式下detail绘制进度(index)
    this.prevReviewNode = 0; // Review模式下上一个节点索引
  }

  startDrawing = (e, timestamp) => {
    this.isDrawing = true;
    let currentTime = 0;
    if (typeof timestamp === "undefined") currentTime = Date.now();
    else currentTime = timestamp - this.startTime;

    // 初始化绘制样式
    this.ctx.beginPath();
    this.ctx.lineWidth = 6;
    this.ctx.lineCap = "round";

    if (this.standardNodesCnt !== 0) {
      this.ctx.moveTo(
        this.standardDetailNodes[this.progress].x,
        this.standardDetailNodes[this.progress].y
      );
      this.ctx.strokeStyle = this.typeToColor(-99); // passive+active画笔颜色
    } else {
      this.ctx.moveTo(e.offsetX, e.offsetY);
      this.ctx.strokeStyle = this.typeToColor(-99); // active画笔颜色
    }
    if (!this.startTime) this.startTime = currentTime;
    this.passiveCtx.beginPath();
    this.passiveCtx.lineWidth = 3;
    this.passiveCtx.lineCap = "round";
    this.passiveCtx.strokeStyle = this.typeToColor(99); // passive画笔颜色
    this.passiveCtx.moveTo(e.offsetX, e.offsetY);
  };

  draw = (e, timestamp) => {
    if (this.standardNodesCnt !== 0) {
      return this.passiveDraw(e, timestamp);
    }
    let currentTime = 0;
    if (typeof timestamp === "undefined")
      currentTime = Date.now() - this.startTime;
    else currentTime = timestamp - this.startTime;

    if (!this.isDrawing) return null;
    if (this.onNode) {
      this.onNode = false;
      this.startDrawing(e);
      return null;
    }

    const currentX = e.offsetX;
    const currentY = e.offsetY;
    if (currentX === this.lastPos.x && currentY === this.lastPos.y) return null;

    // 绘制基础轨迹
    this.ctx.moveTo(this.lastPos.x, this.lastPos.y);
    this.ctx.lineTo(currentX, currentY);
    this.ctx.stroke();
    let manhattanDist = 0;
    // 节点绘制逻辑
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
      this.drawNode(currentX, currentY, this.typeToColor(-1));
      nodesIndex = this.nodes.length - 1;
    } else {
      const lastNode = this.nodes[this.nodes.length - 1];
      const lastNode2 = this.nodes[this.nodes.length - 2];
      manhattanDist =
        Math.abs(currentX - lastNode.x) + Math.abs(currentY - lastNode.y);

      this.lastSpeedCheck++;
      if (this.lastSpeedCheck > Track.detailNodesSeparation) {
        // 注意这个参数：过大会导致切分点不准，过小会消耗过多性能产生更多detail点
        this.lastSpeedCheck = 0;
        this.calcSpeedAndAngle(currentX, currentY, currentTime);
      }

      // 条件判断
      if (
        manhattanDist > Track.minNodesSpacingI &&
        this.strokeSpeed <= Track.maxSpeed
      ) {
        this.nodes.push({
          x: this.lastPos2.x,
          y: this.lastPos2.y,
          type: 0,
          time: currentTime,
          detailIndex: this.detailNodes.length,
          prevDetailIndex: lastNode.detailIndex,
        });
        this.drawNode(this.lastPos2.x, this.lastPos2.y, this.typeToColor(0));
        this.lastSpeedCheck = 0; // 防止一个节点连续出现多个节点（与节点距离过小，容易出现测量错误）
        this.angle = 0;
        this.strokeSpeed = 9999;
        nodesIndex = this.nodes.length - 1;
      } else if (
        manhattanDist > Track.minNodesSpacingII &&
        (this.angle > Track.minAngleAbs || -this.angle > Track.minAngleAbs)
      ) {
        this.nodes.push({
          x: this.lastPos2.x,
          y: this.lastPos2.y,
          type: 1,
          time: currentTime,
          detailIndex: this.detailNodes.length,
          prevDetailIndex: lastNode.detailIndex,
        });
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
    // console.log(standardData);
    const { nodes, detailNodes } = standardData;
    // console.log(nodes, detailNodes);
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
    // 如果用户不移动鼠标，此函数会不被调用导致卡顿，但由于最终是由定频率姿态检测输入，不会出现这种情况

    let score = 0;

    if (
      !this.isDrawing ||
      this.progress >= this.standardDetailCnt ||
      this.nodeProgress >= this.standardNodesCnt
    )
      return score;

    let currentTime = 0;
    if (typeof timestamp === "undefined")
      currentTime = Date.now() - this.startTime;
    else currentTime = timestamp - this.startTime;

    if (e.offsetX === null)
      e = { offsetX: this.lastPos.x, offsetY: this.lastPos.y };
    const currentX = e.offsetX;
    const currentY = e.offsetY;
    if (this.onNode) {
      this.onNode = false;
      this.startDrawing(e);
      return score;
    }
    // console.log(currentTime, this.progress, this.standardDetailNodes, this.standardNodes);
    while (currentTime > this.standardDetailNodes[this.progress].time) {
      this.detailNodes.push({
        x: currentX,
        y: currentY,
        time: currentTime,
      });
      this.progress++;
      if (this.progress == this.standardDetailCnt) return 0;
    }
    const cstd = this.standardDetailNodes[this.progress];

    const isMajor = this.standardNodes[this.nodeProgress].hasOwnProperty(
      "major"
    )
      ? this.standardNodes[this.nodeProgress].major
      : false;
    if (debug && isMajor) {
      // 绘制基础轨迹
      this.passiveCtx.moveTo(this.lastPos.x, this.lastPos.y);
      this.passiveCtx.lineTo(currentX, currentY);
      this.passiveCtx.stroke();
      // 绘制standard轨迹
      if (this.progress > 0) {
        const prevCstd = this.standardDetailNodes[this.progress - 1];
        this.ctx.moveTo(prevCstd.x, prevCstd.y);
        this.ctx.lineTo(cstd.x, cstd.y);
        this.ctx.stroke();
      }
    }

    let cstdn = this.standardNodes[this.nodeProgress];
    // if (cstdn.type === -1)
    //   this.drawNode(cstdn.x, cstdn.y, this.typeToColor(cstdn.type)); // 绘制节点
    while (currentTime > cstdn.time) {
      // 计算上一段的残差平方和作为分数储存（消除起点偏移）
      this.nodes.push({
        x: currentX,
        y: currentY,
        type: cstdn.type,
        time: currentTime,
      });
      // 计算score
      if (cstdn.detailIndex > cstdn.prevDetailIndex) {
        const deltaX =
          this.standardDetailNodes[cstdn.prevDetailIndex].x -
          this.detailNodes[cstdn.prevDetailIndex].x;
        const deltaY =
          this.standardDetailNodes[cstdn.prevDetailIndex].y -
          this.detailNodes[cstdn.prevDetailIndex].y; // 标准轨迹和用户轨迹起点的差距
        let relativeX = 0,
          relativeY = 0;

        for (let i = cstdn.prevDetailIndex; i < cstdn.detailIndex; i++) {
          relativeX =
            this.standardDetailNodes[i].x - this.detailNodes[i].x - deltaX;
          relativeY =
            this.standardDetailNodes[i].y - this.detailNodes[i].y - deltaY;
          score += relativeX ** 2 + relativeY ** 2;
        }
        score = parseInt(
          Math.max(
            100 - score / 128 / (cstdn.detailIndex - cstdn.prevDetailIndex),
            0
          )
        );
        // 除以节点数量，防止标准轨迹长度过长导致分数过低（或反之亦然）
      } else score = 0; // 起点节点不计算分数
      this.score[this.nodeProgress] = score;
      this.onNode = true;
      if (debug) {
        this.drawNode(currentX, currentY, this.typeToColor(99)); // 绘制用户轨迹节点
      }
      // 绘制分数
      const midPoint =
        this.detailNodes[(cstdn.detailIndex + cstdn.prevDetailIndex) >> 1]; // 上一段的中点

      if (debug && this.nodeProgress > 1) {
        // 跳过第一段起点节点的分数绘制
        // 将分数打印在passiveCtx的上一段轨迹的中间
        this.passiveCtx.beginPath();
        this.passiveCtx.moveTo(midPoint.x, midPoint.y);
        this.passiveCtx.font = "20px Arial";
        this.passiveCtx.fillStyle = "rgba(0, 0.5)";
        this.passiveCtx.fillText(score, midPoint.x - 10, midPoint.y - 10);
        this.passiveCtx.closePath();
      }
      this.nodeProgress++;
      if (this.nodeProgress >= this.standardNodesCnt) return score;
      cstdn = this.standardNodes[this.nodeProgress]; // 画出下一段的标准节点
      if (debug) {
        this.drawNode(cstdn.x, cstdn.y, this.typeToColor(cstdn.type));
      }
    }
    this.lastPos = { x: currentX, y: currentY };
    return score;
  };
  reviewDraw = (prevReviewTime, currentTime) => {
    if (this.prevReviewNode >= this.standardNodesCnt) return;
    let currentReviewNT = this.standardNodes[this.prevReviewNode].time;
    while (this.prevReviewNode < this.standardNodesCnt && currentReviewNT >= prevReviewTime && currentReviewNT <= currentTime) {
      this.detailProgress = this.standardNodes[this.prevReviewNode].prevDetailIndex;
      midDetailProgress = (this.detailProgress + this.standardNodes[this.prevReviewNode].prevDetailIndex) >> 1;
      // 上一个标准节点
      this.drawNode(
        this.standardNodes[nodeIndex].x,
        this.standardNodes[nodeIndex].y,
        this.typeToColor(this.standardNodes[nodeIndex].type)
      );
      // 上一个用户节点
      this.drawNode(
        this.nodes[nodeIndex].x,
        this.nodes[nodeIndex].y,
        this.typeToColor(99)
      );
      // 绘制分数
      const midPoint = this.detailNodes[midDetailProgress];
      this.passiveCtx.beginPath();
      this.passiveCtx.moveTo(midPoint.x, midPoint.y);
      this.passiveCtx.font = "20px Arial";
      this.passiveCtx.fillStyle = "rgba(0, 0.5)";
      this.passiveCtx.fillText(
        this.score[this.prevReviewNode],
        midPoint.x - 10,
        midPoint.y - 10
      );
      this.passiveCtx.closePath();
      // 下一个节点
      this.prevReviewNode++;
      // 标准节点
      this.drawNode(
        this.standardNodes[nodeIndex].x,
        this.standardNodes[nodeIndex].y,
        this.typeToColor(this.standardNodes[nodeIndex].type)
      );
      // 用户节点
      this.drawNode(
        this.nodes[nodeIndex + 1].x,
        this.nodes[nodeIndex + 1].y,
        this.typeToColor(99)
      );
      // 标准轨迹
      ctx.beginPath();
      ctx.moveTo(
        this.standardDetailNodes[detailProgress].x,
        this.standardDetailNodes[detailProgress].y
      );
      ctx.lineWidth = 20;
      ctx.strokeStyle = this.typeToColor(-99);
      // 用户轨迹
      passiveCtx.beginPath();
      passiveCtx.moveTo(
        this.detailNodes[detailProgress].x,
        this.detailNodes[detailProgress].y
      );
      passiveCtx.lineWidth = 10;
      passiveCtx.strokeStyle = this.typeToColor(99);
    }
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
    // document.getElementById(
    //   "currentStrokeSpeed"
    // ).innerHTML = `当前速度: ${this.strokeSpeed}px/s`;

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
    const magPrev = Math.sqrt(prevVector.x ** 2 + prevVector.y ** 2);
    const magCurrent = Math.sqrt(currentVector.x ** 2 + currentVector.y ** 2);
    this.angle =
      Math.acos(dotProduct / (magPrev * magCurrent)) * (180 / Math.PI);
    // document.getElementById(
    //   "currentStrokeAngle"
    // ).innerHTML = `当前角度: ${this.angle.toFixed(2)}°`;

    this.detailNodes.push({
      x: this.lastSpeedPos.x,
      y: this.lastSpeedPos.y,
      time: currentTime,
    });
    this.lastSpeedPos = { x: currentX, y: currentY, time: currentTime };
  };

  drawNode = (x, y, color = "rgba(0, 0, 0, 0.5)") => {
    this.ctx.closePath();
    this.ctx.beginPath();
    this.ctx.lineWidth = 12;
    this.ctx.arc(x, y, 12, 0, Math.PI * 2); // 30px直径
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.closePath();
    this.onNode = true;

    return;
    // 连接lastNode，并作中垂线
    const lastNode = this.nodes[this.nodes.length - 1];
    this.ctx.beginPath();
    this.ctx.lineWidth = 10;
    this.ctx.strokeStyle = this.typeToColor(99);
    this.ctx.moveTo(lastNode.x, lastNode.y);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.ctx.closePath();
  };

  endDrawing = (timestamp) => {
    if (!this.isDrawing) return;
    this.draw(
      { offsetX: this.lastPos.x + 1, offsetY: this.lastPos.y + 1 },
      timestamp
    ); // 处理最后一段数据
    this.ctx.closePath();
    this.isDrawing = false;
    this.lastPos = { x: 0, y: 0 };
    this.lastPos2 = { x: 0, y: 0 };
    this.lastSpeedPos = { x: 0, y: 0, time: 0 };
    this.lastSpeedCheck = 0;
    this.progress = 0;
    this.nodeProgress = 0;
    this.startTime = 0;

    this.result = {
      nodes: this.nodes.slice(1),
      detailNodes: this.detailNodes,
      score: this.score,
    };

    this.nodes = [];
    this.detailNodes = [];
    this.score = [];
  };
}
class Action {
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
  seg = [
    5, 6, 5, 7, 5, 11, 7, 9, 6, 8, 6, 12, 8, 10, 11, 13, 13, 15, 12, 14, 14, 16,
    11, 12,
  ];
  segCnt = 12;
  actionTypeToColor = (type) => {
    switch (type) {
      case 0: // 人体连线
        return "rgba(0, 0, 0, 0.5)";
      case 1: // 关节
        return "rgba(238, 130, 238, 0.6)"; // 紫色 ee82ee99
    }
  };
  constructor(canvas, passiveCanvas, skeletonCanvas) {
    this.accumulatedScore = 0;
    this.accumulatedNodesCnt = 0;
    this.progress = 0;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.passiveCanvas = passiveCanvas;
    this.passiveCtx = passiveCanvas.getContext("2d");
    this.skeletonCanvas = skeletonCanvas;
    this.skeletonCtx = skeletonCanvas.getContext("2d");
    // 一共13个关节trackers
    this.trackers = [
      new Track(this.ctx, this.passiveCtx), // 0 nose
      new Track(this.ctx, this.passiveCtx), // 1 leftEye
      new Track(this.ctx, this.passiveCtx), // 2 rightEye
      new Track(this.ctx, this.passiveCtx), // 3 leftEar
      new Track(this.ctx, this.passiveCtx), // 4 rightEar
      new Track(this.ctx, this.passiveCtx), // 5 leftShoulder
      new Track(this.ctx, this.passiveCtx), // 6 rightShoulder
      new Track(this.ctx, this.passiveCtx), // 7 leftElbow
      new Track(this.ctx, this.passiveCtx), // 8 rightElbow
      new Track(this.ctx, this.passiveCtx), // 9 leftWrist
      new Track(this.ctx, this.passiveCtx), // 10 rightWrist
      new Track(this.ctx, this.passiveCtx), // 11 leftHip
      new Track(this.ctx, this.passiveCtx), // 12 rightHip
      new Track(this.ctx, this.passiveCtx), // 13 leftKnee
      new Track(this.ctx, this.passiveCtx), // 14 rightKnee
      new Track(this.ctx, this.passiveCtx), // 15 leftAnkle
      new Track(this.ctx, this.passiveCtx), // 16 rightAnkle
    ];
    this.action = [];
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
            : 0
        ); // 是否是关键点
      }
      newTracker.push(action.time); // 相对时间戳，ms
      newAction.push(newTracker);
    }
    const newTresults = [];
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
          ...(isMajor ? { major: 1 } : {}),
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
    for (let i = 0; i < this.segCnt; i++) {
      const start = this.seg[i << 1];
      const end = this.seg[(i << 1) | 1];
      if (positions[start].offsetX === null || positions[end].offsetX === null)
        continue;
      this.skeletonCtx.beginPath();
      this.skeletonCtx.moveTo(
        positions[start].offsetX,
        positions[start].offsetY
      );
      this.skeletonCtx.lineTo(positions[end].offsetX, positions[end].offsetY);
      this.skeletonCtx.strokeStyle = this.actionTypeToColor(0);
      this.skeletonCtx.lineWidth = 16;
      this.skeletonCtx.stroke();
      this.skeletonCtx.closePath();
    }
    // 绘制关节
    for (let i = 0; i < positions.length; i++) {
      if ((i > 0 && i < 5) || positions[i].offsetX === null) {
        continue;
      }
      this.skeletonCtx.beginPath();
      this.skeletonCtx.arc(
        positions[i].offsetX,
        positions[i].offsetY,
        16,
        0,
        Math.PI * 2
      );
      this.skeletonCtx.fillStyle = this.actionTypeToColor(1);
      this.skeletonCtx.fill();
      this.skeletonCtx.closePath();
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
  markMajor = (actionNodes) => {
    // 将d最大的2个节点标记为major节点
    let maxD = 0,
      maxI = null;
    for (const nodes of Object.keys(actionNodes)) {
      if (actionNodes[nodes].distance > maxD) {
        maxD = actionNodes[nodes].distance;
        maxI = nodes;
      }
      // 如果有多个major节点，则只标记一个。因此先将所有m标签去除
      if (actionNodes[nodes].hasOwnProperty("m"))
        delete actionNodes[nodes].major;
    }
    if (maxI !== null) actionNodes[maxI].major = 1; // 用hasOwnProperty判断major节点。如果是null说明全0，不标记
  };
  draw = (pose, timestamp) => {
    let score = null;

    const positions = pose.keypoints.map((keypoint) => ({
      offsetX: keypoint.position.x,
      offsetY: keypoint.position.y,
    }));
    this.drawSkeletons(positions);

    const actionNodes = {};
    let actionNodesCnt = 0;
    for (let i = 0; i < positions.length; i++) {
      // if (i!== 0)continue; // 测试
      if ((i > 0 && i < 5) || positions[i].offsetX === null) {
        // 外部已经将置信度过低的节点替换成null
        continue;
      }
      const nodesInfo = this.trackers[i].draw(positions[i], timestamp);
      if (nodesInfo !== null && nodesInfo.index !== null)
        (actionNodes[i] = nodesInfo), actionNodesCnt++;
    }
    if (actionNodesCnt === 0) return score;
    // 遇到了动作节点
    if (timestamp - this.lastActionTime < 1000) {
      // ms，如果是frame需要调参
      const prevActionNodes = this.action[this.action.length - 1].nodes;
      // 动作节点连续，合并(无需处理tracker逻辑，零碎节点误判不会影响动作回放)
      for (const nodes of Object.keys(actionNodes))
        if (!prevActionNodes.hasOwnProperty(nodes))
          prevActionNodes[nodes] = actionNodes[nodes];
      this.markMajor(prevActionNodes);
      this.action[this.action.length - 1].nodes = prevActionNodes;
    } else {
      // 每个动作清空一次ctx和passiveCtx，避免过于混乱
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.passiveCtx.clearRect(
        0,
        0,
        this.passiveCanvas.width,
        this.passiveCanvas.height
      );
      this.markMajor(actionNodes);
      this.action.push({
        nodes: actionNodes,
        time: timestamp - this.startTime,
      });
      this.lastActionTime = timestamp;
    }
    return score;
  };
  passiveDraw = (pose, timestamp) => {
    let score = 0;

    const positions = pose.keypoints.map((keypoint) => ({
      offsetX: keypoint.position.x,
      offsetY: keypoint.position.y,
    }));
    this.drawSkeletons(positions);
    // 如果遇到动作节点了，先清屏，然后再处理动作节点，最后才能计算分数
    const currentTime = timestamp - this.startTime;
    const prevProgress = this.progress;
    while (
      this.progress < this.standardActionsCnt &&
      currentTime > this.standardActions[this.progress].time
    ) {
      this.progress++;
    }
    // 清屏
    if (this.progress !== prevProgress) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.passiveCtx.clearRect(
        0,
        0,
        this.passiveCanvas.width,
        this.passiveCanvas.height
      );
    }
    // 处理动作节点
    for (let i = 0; i < this.trackers.length; i++) {
      let subScore = this.trackers[i].passiveDraw(positions[i], timestamp);
      if (subScore !== 0) {
        console.log(subScore);
        this.accumulatedScore += subScore;
        this.accumulatedNodesCnt++;
      }
    }
    // 计算分数
    if (this.progress !== prevProgress) {
      console.log(
        this.progress,
        this.accumulatedNodesCnt,
        this.accumulatedScore
      );

      if (this.accumulatedNodesCnt > 0) {
        score = this.accumulatedScore / this.accumulatedNodesCnt;
        this.accumulatedScore = 0;
        this.accumulatedNodesCnt = 0;
      }
    }
    return score;
  };
  reviewDraw = (currentTime) => {
    if (this.prevReviewTime) {
      for (const tracker of this.trackers) {
        tracker.reviewDraw(this.prevReviewTime, currentTime);
      }
    }
    this.prevReviewTime = currentTime;
  };

  endDrawing = (timestamp) => {
    this.isDrawing = false;
    for (let i = 0; i < this.trackers.length; i++) {
      this.trackers[i].endDrawing(timestamp);
    }
    this.lastActionTime = -9999;
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
}
