/**
 * @license
 * Modifications Copyright 2025 Cereanilla/SYSU SIC. All Rights Reserved.
 * 林泽 中山大学集成电路学院
 *
 *    NOTICES FROM ORIGINAL PROJECT:
 *    Original Project: https://github.com/tensorflow/tfjs-models/tree/master/pose-detection
 *    Original Demo: https://storage.googleapis.com/tfjs-models/demos/posenet/camera.html
 *
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 *
 *
 */

// 相机模块
export class ActionCamera {
  DEFAULT_CONFIG = {
    // 姿态识别参数设置和对象保存
    algorithm: "multi-pose", // 姿态识别算法，single-pose或multi-pose
    input: {
      usePoseNet: false, // 【🌟】使用PoseNet(true)还是MoveNet(false)，默认使用MoveNet
      videoWidth: 720,
      videoHeight: 540,
      loadedCallback: null, // 模型加载完成回调函数
    },
    poseNetInput: {
      // PosNet
      architecture: "MobileNetV1", // 【🌟】ResNet50/MobileNetV1，姿态识别模型架构
      outputStride: 8, // 【🌟】姿态识别模型输出步长，MobileNetV1=8/16，ResNet50=16/32，越大越精细，但会增加计算量
      inputResolution: 200, // 姿态识别模型精度，200-900，越大越精细，但会增加计算量
      multiplier: 0.75, // 【🌟】姿态识别模型缩放比例，0.5/0.75/1.0，越大越精细，但会增加计算量
      quantBytes: 2, // 【🌟】1/2/4，模型权重量化比例，越大越精细，但会增加计算量
    },
    moveNetInput: {
      // MoveNet
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER, // 【🌟】可选SINGLEPOSE_THUNDER或SINGLEPOSE_LIGHTNING
    },
    singlePoseDetection: {
      minPoseConfidence: 0.1, // 最小姿态置信度，越高则越不容易在没人时误判为有人，但也容易无法及时发现人物或产生时有时无的问题
      // minPartConfidence: 0.5, // PosNet，最小关节点置信度，越高则越不容易将物体误判为关节，但越容易漏关节
      minPartConfidence: 0.05, // MoveNet的参数略低于PosNet，但效果更好
    },
    multiPoseDetection: {
      maxPoseDetections: 3, // 最多识别人数
      minPoseConfidence: 0.01, // 同上，越高则越不容易将物体误判为人，但也越容易漏掉人物
      minPartConfidence: 0.005, // 同上
      nmsRadius: 30.0, // 非极大值抑制半径，越大则越不容易将相似的姿态合并
    },
    output: {
      // 辅助图形配置
      showSkeletons: true, // 显示骨架（黑色折线）
      showPoints: true, // 显示关节点（动态粉色实心圆点）
      stats: null, // Stats.js中的Stats对象，或者任何拥有begin和end方法的对象，本类会在每一帧处理时调用一次，null则禁用
      // showStandardTrack: true, // 显示标准轨迹（灰色半透明粗线条）
      // showUserTrack: true, // 显示用户轨迹（黄色实线条）
      // showStandardNodes: true, // 显示标准节点（静态的粉色、绿色和蓝色半透明圆点）
      // showUserNodes: false, // 显示用户节点（静态的黄色半透明圆点）
      // showScore: false, // 在每段用户轨迹中部显示评分（静态的黑色文字，整数）
      flipPoseHorizontal: true, // 手动水平翻转(因为是前置摄像头，所以要手动翻转)
      posesQueueLength: 5, // 姿态队列长度，越长则越不容易漏掉姿态，但也越容易卡顿
      displayCacheSkeleton: true, // 缓存过程中是否渲染骨架和关节（同普通骨架和关节颜色）
    },
    net: null, // 姿态识别模型对象，null表示尚未加载完毕
  };

  constructor(
    remoteVideo,
    localCamera,
    remoteCanvas,
    localCanvas,
    config = null
  ) {
    this.checkConfig(config); // 检查配置参数是否合法
    this.remoteVideo = remoteVideo; // 远端标准视频video元素
    // 标准视频可用remoteVideo的src属性或source设置，建议简单背景，单人全身，使用适合web加载的视频格式，widthxheight的分辨率
    this.localCamera = localCamera; // 本地摄像头video元素
    this.remoteCanvas = remoteCanvas; // 远端标准动作骨架canvas元素
    this.localCanvas = localCanvas; // 本地摄像头用户动作骨架canvas元素
    // 我修改了pose-detection.min.js，将其中的所有https://tfhub.dev/删去，这样所有的资源都会从本域名加载(就是从本项目的google文件夹)
    // usePoseNet变量，在index.html中定义，使用poseNet还是MoveNet，默认使用MoveNet

    this.enabled_1 = false; // 标记运行状态
    this.halt = false; // 标记用户是否手动停止了播放视频
    this.cameraStream = null; // 用户摄像头流，点击开始时初始化，结束时用于关闭摄像头

    this.round = -1; // 标记当前rAF轮数，刚开始的一轮需要特殊处理（-1未开始或已结束，0准备中）
    this.waiting = 0; // 标记等待模型加载完毕的提示框是否已经显示
    this.tip = 0; // 提示用户的站立位置（远离、靠近、调整摄像头）

    this.seg = [
      // 关节连接关系，两两链接
      5, 6, 5, 7, 5, 11, 7, 9, 6, 8, 6, 12, 8, 10, 11, 13, 13, 15, 12, 14, 14,
      16, 11, 12,
    ];
    this.segCnt = 12; // 肢体段数
    this.pointCnt = 17; // 关节点数

    navigator.getUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia; // 兼容性处理

    this.finalScore = 0; // 检测到视频结束时，返回最终分数而不再是最近1s的平均分
    this.finalRemoteCache = null; // 远端视频缓存数据（在完成姿态识别全部过程后跟着最终分数一起返回）

    this.poseScoring = new PoseScoring(); // 动作评分模块

    if (config) {
      this.Config = this._copy(config); // 姿态识别参数配置
    } else {
      this.Config = this._copy(DEFAULT_CONFIG); // PosNet和MoveNet都在库中硬编码了从google云下载的模型，大约几十MB，国内需要魔法
    }
    this._bindPage().then(this.Config.input.loadedCallback); // posenet模型需要联网加载，所以预先异步加载(无需等待DOM加载完成)
  }

  getConfig() {
    // 获取姿态识别参数配置
    return this._copy(this.Config);
  }
  _copy(origin) {
    // 递归拷贝origin对象
    const result = {};
    for (const [key, value] of Object.entries(origin)) {
      if (typeof value === "object" && value !== null) {
        result[key] = this._copy(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  checkConfig(config) {
    // 检查配置参数是否合法
    const input = config.input;
    const poseNetInput = config.poseNetInput;
    const moveNetInput = config.moveNetInput;
    const singlePoseDetection = config.singlePoseDetection;
    const multiPoseDetection = config.multiPoseDetection;
    const output = config.output;
    if (input.videoWidth % 1 !== 0 || input.videoHeight % 1 !== 0) {
      throw new Error(
        "input.videoWidth and input.videoHeight must be integers"
      );
    }
    if (input.loadedCallback && typeof input.loadedCallback !== "function") {
      throw new Error("input.loadedCallback must be a function");
    }
    if (input.usePoseNet) {
      // 使用PoseNet
      if (poseNetInput.architecture === "MobileNetV1") {
        if (
          poseNetInput.outputStride !== 8 &&
          poseNetInput.outputStride !== 16
        ) {
          throw new Error(
            "MobileNetV1 poseNetInput.outputStride must be 8 or 16"
          );
        }
        if (
          poseNetInput.multiplier !== 0.5 ||
          poseNetInput.multiplier !== 0.75 ||
          poseNetInput.multiplier !== 1.0
        ) {
          throw new Error(
            "MobileNetV1 poseNetInput.multiplier must be 0.5, 0.75 or 1.0"
          );
        }
      } else if (poseNetInput.architecture === "ResNet50") {
        if (
          poseNetInput.outputStride !== 16 &&
          poseNetInput.outputStride !== 32
        ) {
          throw new Error("poseNetInput.outputStride must be 16 or 32");
        }
        if (poseNetInput.multiplier !== 1.0) {
          throw new Error("MobileNetV1 poseNetInput.multiplier must be 1.0");
        }
      } else {
        throw new Error(
          "poseNetInput.architecture must be MobileNetV1 or ResNet50"
        );
      }
      if (
        poseNetInput.inputResolution < 200 ||
        poseNetInput.inputResolution > 900
      ) {
        throw new Error(
          "poseNetInput.inputResolution must be between 200 and 900"
        );
      }
      if (
        poseNetInput.quantBytes !== 1 &&
        poseNetInput.quantBytes !== 2 &&
        poseNetInput.quantBytes !== 4
      ) {
        throw new Error("poseNetInput.quantBytes must be 1, 2 or 4");
      }
    } else {
      // 使用MoveNet
      if (
        moveNetInput.modelType !==
          poseDetection.movenet.modelType.SINGLEPOSE_THUNDER &&
        moveNetInput.modelType !==
          poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      ) {
        throw new Error(
          "moveNetInput.modelType must be SINGLEPOSE_THUNDER or SINGLEPOSE_LIGHTNING"
        );
      }
    }
    if (
      singlePoseDetection.minPoseConfidence < 0 ||
      singlePoseDetection.minPoseConfidence > 1
    ) {
      throw new Error(
        "singlePoseDetection.minPoseConfidence must be between 0 and 1"
      );
    }
    if (
      singlePoseDetection.minPartConfidence < 0 ||
      singlePoseDetection.minPartConfidence > 1
    ) {
      throw new Error(
        "singlePoseDetection.minPartConfidence must be between 0 and 1"
      );
    }
    if (
      multiPoseDetection.maxPoseDetections < 1 ||
      multiPoseDetection.maxPoseDetections > 10 ||
      multiPoseDetection.maxPoseDetections % 1 !== 0
    ) {
      throw new Error(
        "multiPoseDetection.maxPoseDetections must be an integer and between 1 and 10"
      );
    }
    if (
      multiPoseDetection.minPoseConfidence < 0 ||
      multiPoseDetection.minPoseConfidence > 1
    ) {
      throw new Error(
        "multiPoseDetection.minPoseConfidence must be between 0 and 1"
      );
    }
    if (
      multiPoseDetection.minPartConfidence < 0 ||
      multiPoseDetection.minPartConfidence > 1
    ) {
      throw new Error(
        "multiPoseDetection.minPartConfidence must be between 0 and 1"
      );
    }
    if (multiPoseDetection.nmsRadius < 0) {
      throw new Error("multiPoseDetection.nmsRadius must be positive");
    }
    if (output.showSkeletons !== true && output.showSkeletons !== false) {
      throw new Error("output.showSkeletons must be true or false");
    }
    if (output.showPoints !== true && output.showPoints !== false) {
      throw new Error("output.showPoints must be true or false");
    }
    if (output.stats && typeof output.stats.begin !== "function") {
      throw new Error("output.stats must have a begin() method");
    }
    if (output.stats && typeof output.stats.end !== "function") {
      throw new Error("output.stats must have an end() method");
    }
    if (
      output.flipPoseHorizontal !== true &&
      output.flipPoseHorizontal !== false
    ) {
      throw new Error("output.flipPoseHorizontal must be true or false");
    }
    if (output.posesQueueLength < 1 || output.posesQueueLength > 10) {
      throw new Error("output.posesQueueLength must be between 1 and 10");
    }
    if (
      output.displayCacheSkeleton !== true &&
      output.displayCacheSkeleton !== false
    ) {
      throw new Error("output.displayCacheSkeleton must be true or false");
    }
  }
  setConfig(config) {
    // 设置姿态识别参数配置
    this.checkConfig(config);
    // 检查需要重载的几个配置有无改变
    const usePoseNet = config.input.usePoseNet;
    const architecture = config.poseNetInput.architecture;
    const outputStride = config.poseNetInput.inputResolution;
    const multiplier = config.poseNetInput.multiplier;
    const quantBytes = config.poseNetInput.quantBytes;
    const modelType = config.moveNetInput.modelType;
    this.Config = this._copy(config);
    if (
      usePoseNet !== this.Config.input.usePoseNet ||
      architecture !== this.Config.poseNetInput.architecture ||
      outputStride !== this.Config.poseNetInput.outputStride ||
      multiplier !== this.Config.poseNetInput.multiplier ||
      quantBytes !== this.Config.poseNetInput.quantBytes ||
      modelType !== this.Config.moveNetInput.modelType
    ) {
      // 重载模型
      this._bindPage(); // 重新加载模型
    }
  }
  getStatus() {
    // 获取当前运行状态（在开始后定时调用，以获取最新分数）
    const result = {
      score: this.poseScoring.averageScore(Date.now()), // 最新1s内分数
      tip: this.tip, // 提示用户的站立位置（远离、靠近、调整摄像头）
      paused: this.remoteVideo.paused && this.enabled_1, // 是否暂停播放（姿态解算不暂停，可用于调整模仿）
      currentTime: this.remoteVideo.currentTime, // 当前视频播放位置
      duration: this.remoteVideo.duration, // 当前视频总时长
      finalScore: this.finalScore, // 是否有最终分数返回（每次播放只会返回一次）
      finalRemoteCache: this.finalRemoteCache, // 是否有标准视频缓存数据返回（每次播放只会返回一次）
      waiting: this.waiting, // 模型是否还在加载
    };
    this.finalScore = null; // 只返回一次结束信号
    this.finalRemoteCache = null; // 只返回一次缓存
    return result;
  }

  async _bindPage() {
    // 加载模型
    if (this.Config.net) {
      // 已经加载过模型，先清除
      this.Config.net.dispose();
      this.Config.net = null; // 如果这是开始，则要求用户等待
    }
    if (this.Config.input.usePoseNet) {
      this.Config.net = await posenet.load({
        architecture: this.Config.poseNetInput.architecture,
        outputStride: this.Config.poseNetInput.outputStride,
        inputResolution: this.Config.poseNetInput.inputResolution,
        multiplier: this.Config.poseNetInput.multiplier,
        quantBytes: this.Config.poseNetInput.quantBytes,
      });
    } else {
      // MoveNet:
      const model = poseDetection.SupportedModels.MoveNet;
      const detectorConfig = {
        modelType: this.Config.moveNetInput.modelType,
      };
      this.Config.net = await poseDetection.createDetector(
        model,
        detectorConfig
      ); // 异步下载
    }
  }

  async startPlaying(
    standardSrc,
    customSrc = null,
    standardCache = null,
    customCache = null
  ) {
    // standardSrc：标准视频源url；customSrc：自定义视频源url（若为null，则打开摄像头获取）
    // 自定义视频源可用于加载标准视频，对照，将标准视频当成用户输入，用于测试算法是否能正确评分
    // standardCache：标准视频缓存数据；customCache：自定义视频缓存数据（若为null，则实时解算）
    if (this.enabled_1) return false; // 要先停止才能切换录制和评分模式
    this.enabled_1 = true; // 标记正在运行

    const remoteVideo = this.remoteVideo;
    const leftSkeletonCanvas = this.localCanvas; // 骨架画布
    const rightSkeletonCanvas = this.remoteCanvas; // 骨架画布
    const userCameraCanvas = this.localCamera;

    this._loadRemoteVideo(remoteVideo, standardSrc); // 配置远程视频（加载标准视频，用于教学和比对）

    if (customSrc) {
      // 链接获取用户动作
      this._loadRemoteVideo(localVideo, customSrc);
      this.Config.output.flipPoseHorizontal = false; // 视频模式或后置摄像头不需要翻转（前置摄像头才要）
      userCameraCanvas.style.transform = "scaleX(1)"; // 取消画布翻转
      this._detectPoseInRealTime(standardCache, customSrc);
    } else {
      // 摄像头获取用户动作
      this.Config.output.flipPoseHorizontal = true; // 手动翻转，因为是前置摄像头
      userCameraCanvas.style.transform = "scaleX(-1)"; // 手动翻转画布
      try {
        this._loadCameraCanvas(userCameraCanvas); // 配置用户的摄像头（打开并开始拍摄，但是还没有保存，也没有处理）
      } catch (e) {
        throw new Error("加载摄像头失败，请确认当前设备有摄像头：" + e.message);
      }
      this._detectPoseInRealTime(
        standardCache,
        customCache // 在HTML中通过script标签加载的静态缓存数据
      ); // 主模块，用于姿态识别并评分
    }
    return true; // 成功开启
  }

  async startCaching(standardSrc) {
    // 缓存数据，用于比对
    if (this.enabled_1) return false; // 要先停止才能切换录制和评分模式
    this.enabled_1 = true; // 标记正在运行
    const remoteVideo = this.remoteVideo;
    this._loadRemoteVideo(remoteVideo, standardSrc); // 配置远程视频（加载标准视频，用于计算姿态并缓存）
    this._calcCacheInRealTime(remoteVideo);
  }

  async stopPlaying() {
    const remoteVideo = this.remoteVideo;
    const localCamera = this.localCamera;
    if (this.round > -1) {
      this.halt = true; // 停止远程视频播放，先停止detect pose
      return;
    }
    this.halt = false;
    this.enabled_1 = false;
    // close the camera
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }
    // stop the message source
    if (this.remoteVideo.src) {
      // 是个链接，需要清除
      remoteVideo.setAttribute("src", "");
      remoteVideo.style.opacity = 0;
      localCamera.setAttribute("src", "");
      localCamera.style.opacity = 0;
    }
  }

  // 打开摄像头
  async _setupCamera(cameraCanvas) {
    // 平台检测
    function isAndroid() {
      return /Android/i.test(navigator.userAgent);
    }

    function isiOS() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }

    function isMobile() {
      return isAndroid() || isiOS();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Browser API navigator.mediaDevices.getUserMedia not available"
      );
    }

    const videoWidth = this.Config.input.videoWidth;
    const videoHeight = this.Config.input.videoHeight;
    cameraCanvas.width = videoWidth;
    cameraCanvas.height = videoHeight;

    const mobile = isMobile();
    this.cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: mobile ? undefined : videoWidth,
        height: mobile ? undefined : videoHeight,
      },
    });
    cameraCanvas.srcObject = this.cameraStream;

    return new Promise((resolve) => {
      cameraCanvas.onloadedmetadata = () => {
        resolve(cameraCanvas);
      };
    });
  }

  // 将画布连接到用户摄像头
  async _loadCameraCanvas(userCameraCanvas) {
    userCameraCanvas = await this._setupCamera(userCameraCanvas); // 打开摄像头
    userCameraCanvas.style.opacity = 1;
    userCameraCanvas.width = this.Config.input.videoWidth;
    userCameraCanvas.height = this.Config.input.videoHeight;
    userCameraCanvas.play(); // 开始拍摄（但是还没有保存，也没有处理）
  }

  // 将画布连接到标准视频
  async _loadRemoteVideo(remoteVideo, customSrc) {
    if (!customSrc) throw new Error("请指定标准视频地址");
    remoteVideo.srcObj = null; // 先清除原视频
    remoteVideo.src = customSrc;
    remoteVideo.load();
    remoteVideo.style.opacity = 1;
    remoteVideo.width = this.Config.input.videoWidth;
    remoteVideo.height = this.Config.input.videoHeight;
  }

  _drawSkeletons(pose, skeletonCtx, poseConf, partConf) {
    // pose结构: {keypoints: [{position: {x: number, y: number}, score: number},...], score: number}
    // 绘制人体骨骼
    if (pose.score < poseConf) return; // 姿态置信度不够，不画
    const keypoints = pose.keypoints;
    if (this.Config.output.showSkeletons) {
      skeletonCtx.beginPath();
      for (let i = 0; i < this.segCnt; i++) {
        // 遍历每一段肢体
        const start = this.seg[i << 1]; // 开始关节
        const end = this.seg[(i << 1) | 1]; // 结束关节
        const pointStart = keypoints[start]; // 开始关节坐标
        const pointEnd = keypoints[end]; // 结束关节坐标
        if (
          pointStart.x === null ||
          pointEnd.x === null ||
          keypoints[start].score < partConf ||
          keypoints[end].score < partConf
        )
          continue; // 有其中一个关节没有出现或置信度不够，这一段肢体不画
        skeletonCtx.moveTo(pointStart.x, pointStart.y);
        skeletonCtx.lineTo(pointEnd.x, pointEnd.y);
      }
      skeletonCtx.stroke();
    }
    // 绘制关节
    if (this.Config.output.showPoints) {
      skeletonCtx.beginPath();
      for (let i = 0; i < keypoints.length; i++) {
        const point = keypoints[i];
        if (
          (i > 0 && i < 5) ||
          point.x === null ||
          keypoints[i].score < partConf
        ) {
          continue; // 头部不画左右眼、左右耳，只画鼻子
        }
        // 避免圆点之间被填充
        skeletonCtx.moveTo(point.x, point.y);
        // 绘制圆点
        skeletonCtx.arc(point.x, point.y, 16, 0, Math.PI * 2);
      }
      skeletonCtx.fill();
    }
  }

  _standardize(poses) {
    // 将PosNet的输出结果统一为MoveNet的输出格式：
    const after = poses.map((pose) => {
      return {
        keypoints: pose.keypoints.map((keypoint) => {
          return {
            x: keypoint.position.x,
            y: keypoint.position.y,
            score: keypoint.score,
          };
        }),
        score: pose.score,
      };
    });
    return after;
  }

  async _singlePoseEstimate(video) {
    // 单人姿态识别
    // PosNet:
    if (this.Config.input.usePoseNet) {
      return this._standardize(
        await this.Config.net.estimatePoses(video, {
          decodingMethod: "single-person",
        })
      );
    } else {
      // MoveNet:
      return await this.Config.net.estimatePoses(video);
    }
  }

  async _multiPoseEstimate(video) {
    // 多人姿态识别
    // PosNet:
    if (this.Config.input.usePoseNet) {
      return this._standardize(
        await this.Config.net.estimatePoses(video, {
          decodingMethod: "multi-person",
          maxDetections: this.Config.multiPoseDetection.maxPoseDetections,
          scoreThreshold: this.Config.multiPoseDetection.minPartConfidence,
          nmsRadius: this.Config.multiPoseDetection.nmsRadius,
        })
      );
    } else {
      // MoveNet:（注意，MoveNet不能检测多人，只会返回一个长度的数组）
      return await this.Config.net.estimatePoses(video, {
        maxDetections: this.Config.multiPoseDetection.maxPoseDetections,
        scoreThreshold: this.Config.multiPoseDetection.minPartConfidence,
        nmsRadius: this.Config.multiPoseDetection.nmsRadius,
      });
    }
  }

  _chkNotReady(video) {
    return video.readyState !== video.HAVE_ENOUGH_DATA;
  }

  _flipHorizontal(poses) {
    // 手动水平翻转(MoveNet没有内置这个功能)
    poses.forEach((pose) => {
      pose.keypoints.forEach((keypoint) => {
        keypoint.x = this.Config.input.videoWidth - keypoint.x; // 至于为何要乘0.75(画框和原视频比例)，暂时不清楚
        keypoint.y = keypoint.y;
      });
    });
  }

  // 姿态计算
  _detectPoseInRealTime(
    remotePoseCache = null, // 如果有远程视频缓存，则传入。如果没有，则生成缓存
    customPoseCache = null
  ) {
    const localCamera = this.localCamera;
    const remoteVideo = this.remoteVideo;
    // 模型尚未加载完毕，或者用户摄像头还没准备好，则等待
    if (
      this.Config.net == null ||
      this._chkNotReady(localCamera) ||
      this._chkNotReady(remoteVideo)
    ) {
      if (this.waiting == 0) {
        this.waiting = 1;
      }
      setTimeout(() => {
        this._detectPoseInRealTime(remotePoseCache, customPoseCache);
      }, 1000); // 1s后再次尝试
      return;
    }
    const endDetect = () => {
      // 显示最终平均分
      this.finalScore = this.poseScoring.totalAverageScore();

      this.poseScoring.clear(); // 清空动作评分
      localPoseWeighting.clear(); // 清空动作加权
      remotePoseWeighting.clear(); // 清空动作加权
      this.round = -1; // 标志rAF已停止
      this.stopPlaying();
      if (!remotePoseCache) {
        this.finalRemoteCache = remotePoseCaching.getObj(); // 输出缓存
      } else {
        remotePoseFromCache.reset(); // 重置加载的缓存（虽然目前还不会再次使用）
      }
    };

    const singlePoseDetectionFrame = async () => {
      if (this.Config.output.stats !== null) {
        this.Config.output.stats.end();
        this.Config.output.stats.begin();
      }
      // 如果视频尚未准备好，则不进行检测
      if (this._chkNotReady(localCamera) || this._chkNotReady(remoteVideo)) {
        requestAnimationFrame(singlePoseDetectionFrame);
        return;
      }
      const localPoses = await this._singlePoseEstimate(localCamera);
      let p;
      if (remotePoseFromCache) {
        p = remotePoseFromCache.getPoses(remoteVideo.currentTime * 1000); // 从缓存中获取远程视频姿态数据
      } else {
        p = await this._singlePoseEstimate(remoteVideo);
        remotePoseCaching.addPoses(p); // 缓存远程视频姿态数据
      }
      const remotePoses = p;

      if (this.Config.output.flipPoseHorizontal) {
        // 手动水平翻转（因为是前置摄像头，所以需要手动翻转）
        this._flipHorizontal(localPoses);
      }

      if (remotePoses.length > 0 && remotePoses[0].score >= poseConf)
        poseProcessingFrame(
          singlePoseDetectionFrame,
          localPoses[0],
          remotePoses[0]
        );
      else requestAnimationFrame(singlePoseDetectionFrame);
    };

    const multiPoseDetectionFrame = async () => {
      if (this.Config.output.stats !== null) {
        this.Config.output.stats.end();
        this.Config.output.stats.begin();
      }
      if (this._chkNotReady(localCamera) || this._chkNotReady(remoteVideo)) {
        requestAnimationFrame(multiPoseDetectionFrame);
        return;
      }
      const localPoses = await this._multiPoseEstimate(localCamera);
      let p;
      if (remotePoseFromCache) {
        p = remotePoseFromCache.getPoses(remoteVideo.currentTime * 1000); // 从缓存中获取远程视频姿态数据
      } else {
        p = await this._multiPoseEstimate(remoteVideo);
        remotePoseCaching.addPoses(p); // 缓存远程视频姿态数据
      }
      const remotePoses = p;

      if (this.Config.output.flipPoseHorizontal) {
        // 手动水平翻转(是用户相机要翻转，因为是前置)
        this._flipHorizontal(localPoses);
      }

      // 由于需要平滑波动防止偶然的关节消失，因此即便part没有超过阈值，也要传入
      if (remotePoses.length > 0 && remotePoses[0].score >= poseConf)
        poseProcessingFrame(
          multiPoseDetectionFrame,
          localPoses[0],
          remotePoses[0]
        );
      else requestAnimationFrame(multiPoseDetectionFrame);
    };

    const poseProcessingFrame = async (
      handle,
      initLocalPose,
      initRemotePose
    ) => {
      // 由handle来控制单人还是多人(需要rAF回调)
      // 平滑
      localPoseWeighting.addPose(initLocalPose, poseConf); // 记录本地动作
      remotePoseWeighting.addPose(initRemotePose, poseConf); // 记录标准视频动作
      const localPose = localPoseWeighting.getPose(); // 平滑后的本地动作
      const remotePose = remotePoseWeighting.getPose(); // 平滑后的标准视频动作
      // 画骨架
      localSkeletonCtx.clearRect(
        0,
        0,
        localSkeletonCanvas.width,
        localSkeletonCanvas.height
      );
      remoteSkeletonCtx.clearRect(
        0,
        0,
        remoteSkeletonCanvas.width,
        remoteSkeletonCanvas.height
      );
      if (localPose)
        this._drawSkeletons(localPose, localSkeletonCtx, poseConf, partConf); // 画本地骨骼
      if (remotePose)
        this._drawSkeletons(remotePose, remoteSkeletonCtx, poseConf, partConf);
      // 画标准视频骨骼
      else {
        requestAnimationFrame(handle); // remote中没有检测到人，直接跳过这一帧
        return;
      }

      this.round++;
      if (this.round == 1) {
        localCamera.play();
        remoteVideo.play(); // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
      } else {
        const scoreInfo = this.poseScoring.transScore(
          localPose,
          remotePose,
          Date.now(),
          remoteVideo.paused
        ); // 记录本地动作
        this.tip = scoreInfo.tip; // 记录提示信息
        // console.log(localPose, remotePose, scoreInfo);
      }
      // 如果结束了，清除定时器
      if (remoteVideo.ended || this.halt) {
        endDetect();
      } else {
        requestAnimationFrame(handle); // continue looping
      }
    };
    // 由于浏览器的视频播放到最后一帧可能不会调用rAF回调函数，因此要多加一个计时器检测并调用endDetect
    const disp = setInterval(() => {
      if (this.round > -1 && (remoteVideo.ended || this.halt)) {
        endDetect();
        clearInterval(disp);
      }
    }, 1000);

    const localSkeletonCanvas = this.localCanvas;
    const remoteSkeletonCanvas = this.remoteCanvas;
    this.waiting = 0;

    const localSkeletonCtx = localSkeletonCanvas.getContext("2d");
    const remoteSkeletonCtx = remoteSkeletonCanvas.getContext("2d");

    localSkeletonCanvas.width = this.Config.input.videoWidth;
    localSkeletonCanvas.height = this.Config.input.videoHeight;
    remoteSkeletonCanvas.width = this.Config.input.videoWidth;
    remoteSkeletonCanvas.height = this.Config.input.videoHeight;

    localSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
    localSkeletonCtx.lineWidth = 16;
    localSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节
    remoteSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
    remoteSkeletonCtx.lineWidth = 16;
    remoteSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节

    this.round = 0; // 标记当前帧数，刚开始的几帧需要特殊处理

    let remotePoseCaching, remotePoseFromCache;
    if (remotePoseCache) {
      remotePoseFromCache = new PoseFromCache(remotePoseCache); // 远程视频姿态数据加载模块
    } else {
      remotePoseCaching = new PoseCaching(); // 远程视频姿态数据缓存模块
    }
    let localPoseWeighting = null,
      remotePoseWeighting = null; // 动作加权模块
    let poseConf, partConf; // 动作置信度阈值
    switch (
      this.Config.algorithm // 根据配置中的算法运行相应的姿态检测函数
    ) {
      case "single-pose":
        localPoseWeighting = new PoseWeighting(
          this.Config.output.posesQueueLength,
          this.Config.singlePoseDetection.minPartConfidence
        );
        remotePoseWeighting = new PoseWeighting(
          this.Config.output.posesQueueLength,
          this.Config.singlePoseDetection.minPartConfidence
        );
        poseConf = this.Config.singlePoseDetection.minPoseConfidence;
        partConf = this.Config.singlePoseDetection.minPartConfidence;
        singlePoseDetectionFrame();
        break;
      case "multi-pose":
        localPoseWeighting = new PoseWeighting(
          this.Config.output.posesQueueLength,
          this.Config.multiPoseDetection.minPartConfidence
        );
        remotePoseWeighting = new PoseWeighting(
          this.Config.output.posesQueueLength,
          this.Config.multiPoseDetection.minPartConfidence
        );
        poseConf = this.Config.multiPoseDetection.minPoseConfidence;
        partConf = this.Config.multiPoseDetection.minPartConfidence;
        multiPoseDetectionFrame();
        break;
      default:
        throw new Error(`Unsupported algorithm: ${this.Config.algorithm}`);
    }
  }
  _calcCacheInRealTime(remoteVideo) {
    // 计算远程视频的姿态缓存（本函数使用了requestVideoFrameCallback，目前不能在火狐浏览器中运行）
    if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
      alert("您的浏览器不支持requestVideoFrameCallback");
      return;
    }
    if (this.Config.net == null || this._chkNotReady(remoteVideo)) {
      if (this.waiting == 0) {
        this.waiting = 1;
      }
      setTimeout(() => {
        this._calcCacheInRealTime(remoteVideo);
      }, 1000); // 1s后再次尝试
      return;
    }

    const endCache = () => {
      clearInterval(disp);
      this.round = -1; // 标志rAF已停止
      this.stopPlaying();
      this.finalRemoteCache = remotePoseCaching.getObj(); // 输出缓存
    };

    const singlePoseCacheFrame = async (now, metadata) => {
      if (this.Config.output.stats !== null) {
        this.Config.output.stats.end();
        this.Config.output.stats.begin();
      }
      if (this._chkNotReady(remoteVideo)) {
        // 视频没准备好，或缓存迅速而视频帧率较低，则跳过
        setTimeout(() => {
          singlePoseCacheFrame(now, metadata);
        }, 100);
        return;
      }
      const poses = await this._singlePoseEstimate(remoteVideo);
      remotePoseCaching.addPoses(poses); // 缓存远程视频姿态数据

      if (this.Config.output.displayCacheSkeleton) {
        console.log(poses);
        remoteSkeletonCtx.clearRect(
          0,
          0,
          remoteSkeletonCanvas.width,
          remoteSkeletonCanvas.height
        );
        for (const pose of poses) // 因为是single，所以只有一个
          this._drawSkeletons(
            pose,
            remoteSkeletonCtx,
            this.Config.multiPoseDetection.minPoseConfidence,
            this.Config.multiPoseDetection.minPartConfidence
          );
      }

      // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
      if (this.round == 0) {
        remoteVideo.play();
      }
      this.round++;
      if (remoteVideo.ended) endCache(); // 视频播放结束，结束姿态检测
      else remoteVideo.requestVideoFrameCallback(singlePoseCacheFrame); // 最后一帧不会被调用，不能在这里检测ended（额，这是bug吧？）
    };

    const multiPoseCacheFrame = async (now, metadata) => {
      if (this.Config.output.stats !== null) {
        this.Config.output.stats.end();
        this.Config.output.stats.begin();
      }
      if (this._chkNotReady(remoteVideo)) {
        setTimeout(() => {
          multiPoseCacheFrame(now, metadata);
        }, 100);
        return;
      }
      const poses = await this._multiPoseEstimate(remoteVideo);
      remotePoseCaching.addPoses(poses); // 缓存远程视频姿态数据

      if (this.Config.output.displayCacheSkeleton) {
        console.log(poses);
        remoteSkeletonCtx.clearRect(
          0,
          0,
          remoteSkeletonCanvas.width,
          remoteSkeletonCanvas.height
        );
        for (const pose of poses)
          this._drawSkeletons(
            pose,
            remoteSkeletonCtx,
            this.Config.multiPoseDetection.minPoseConfidence,
            this.Config.multiPoseDetection.minPartConfidence
          );
      }

      // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
      this.round++;
      if (this.round == 1) {
        remoteVideo.play();
      }
      if (remoteVideo.ended || this.halt)
        endCache(); // 视频播放结束，结束姿态检测
      else remoteVideo.requestVideoFrameCallback(multiPoseCacheFrame); // 最后一帧不会被调用，不能在这里检测ended（额，这是bug吧？）
    };
    // 由于浏览器的视频播放到最后一帧可能不会调用rAF回调函数，因此要多加一个计时器检测并调用endCache
    const disp = setInterval(() => {
      if (this.round > -1 && (remoteVideo.ended || this.halt)) endCache();
    }, 1000);

    this.waiting = 0;

    const remoteSkeletonCanvas = this.remoteCanvas;
    remoteSkeletonCanvas.width = this.Config.input.videoWidth;
    remoteSkeletonCanvas.height = this.Config.input.videoHeight;
    const remoteSkeletonCtx = remoteSkeletonCanvas.getContext("2d");
    remoteSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
    remoteSkeletonCtx.lineWidth = 16;
    remoteSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节

    this.round = 0; // rAF轮数

    const remotePoseCaching = new PoseCaching(); // 远程视频姿态数据缓存模块

    // requestVideoframeCallback需要先播放才能被调用（这一点和rAF不同！）所以一开始必须手动调用
    switch (this.Config.algorithm) {
      case "single-pose":
        singlePoseCacheFrame(0, {});
        break;
      case "multi-pose":
        multiPoseCacheFrame(0, {});
        break;
      default:
        throw new Error(`Unsupported algorithm: ${this.Config.algorithm}`);
    }
    remoteVideo.play();
  }
}
class PoseWeighting {
  // 给姿态加权重+前缀和平移窗口，用于平滑位置的抖动
  constructor(windowSize, minPartConfidence) {
    this.windowSize = windowSize;
    this.posesQueue = []; // 储存最近windowSize个pose，进行平滑抖动
    this.posesQueuelen = 0; // 队列当前长度
    this.weightedMinPartConfidence = minPartConfidence * windowSize; // 关节置信度阈值
    this.keypointsLength = 17; // 关节数量
    this.latestPoseScore = 0; // 平滑不能改变最新的分数，保留
    this.latestPartScore = []; // 记录每个关节的最新分数
  }

  addPose(pose, poseConf) {
    // 结构: {keypoints: [{position: {x: number, y: number}, score: number},...], score: number}
    // 添加动作到平滑队列
    if (!pose) return;
    this.latestPoseScore = pose.score; // 记录最新的分数
    let keypoints = pose.keypoints;
    // 记录动作，并计算前缀和
    // Pfs = Prefix Sum
    const prevWeightedKeypointsPfs =
      this.posesQueuelen > 0
        ? this.posesQueue[this.posesQueuelen - 1]
        : undefined; // 前一帧的动作位置的前缀和
    const weightedKeypointsPfs = [];
    for (let i = 0; i < this.keypointsLength; i++) {
      const keypoint = keypoints[i],
        score = keypoint.score;
      this.latestPartScore[i] = score; // 记录每个关节的最新分数
      try {
        weightedKeypointsPfs.push({
          // 添加每个关节的位置，按照置信度加权，然后计算关节的加权位置前缀和
          x: keypoint.x * score + prevWeightedKeypointsPfs[i].x, // 如果prevWeightedKeypointsPfs是undefined，会抛出异常
          y: keypoint.y * score + prevWeightedKeypointsPfs[i].y,
          score: score + prevWeightedKeypointsPfs[i].score,
        });
      } catch (e) {
        // 第一次没有前缀和
        weightedKeypointsPfs.push({
          x: keypoint.x * score,
          y: keypoint.y * score,
          score: score,
        });
      }
    }
    this.posesQueue.push(weightedKeypointsPfs); // 添加最新的一帧
    if (this.posesQueuelen == this.windowSize) this.posesQueue.shift();
    else this.posesQueuelen++; // 删掉最旧的一帧
  }

  getPose() {
    // 返回结构: {keypoints: [{x: number, y: number, score: number},...], score: number}
    // 产生平滑后的动作位置
    if (!this.posesQueuelen) return undefined;
    const weightedKeypointsPfs = this.posesQueue[this.posesQueuelen - 1]; // 前缀和队列的最后一个
    const B = weightedKeypointsPfs; // 前缀和的末尾
    const A = this.posesQueue[0]; // 前缀和的开头
    const weightedKeypoints = []; // 平滑后的动作位置（不是前缀和了）
    for (let i = 0; i < this.keypointsLength; i++) {
      const score = B[i].score - A[i].score; // 这一串动作的这个关节的置信度之和
      // 如果这个关节的置信度之和小于阈值（阈值已经乘以队列长度），则不画出来
      if (score < this.weightedMinPartConfidence)
        weightedKeypoints.push({ y: null, x: null });
      else
        weightedKeypoints.push({
          y: (B[i].y - A[i].y) / score,
          x: (B[i].x - A[i].x) / score, // 每个位置都乘以了自己的置信度再相加，这里只需要除以总的置信度就能得到位置的平均值
          score: this.latestPartScore[i],
        });
    }
    return { keypoints: weightedKeypoints, score: this.latestPoseScore }; // 返回平滑后的动作位置
  }

  clear() {
    // 清空平滑队列
    this.posesQueue = [];
    this.posesQueuelen = 0;
  }
}

const ALPHA = 16384; // 误差衰减因子，越小越严格
const GAMMA = 3; // 距离倍增幂，越大越严格
// 1048576 4 // 非常严厉，分数两极分化
// 16384 3 // 一般70-80，做得好会有90，做不好大概20-50
const DEFAULT_PENALTY = ALPHA * 50;
const CLOSE_TOLERANCE = 1.6; // 靠太近的视角差距（用户和标准视频的身高比例）容忍百分比
const FAR_TOLERANCE = 0.8; // 远离的
const CONS_BADPOSE = 10; // 姿势差太多的连续帧数后提示用户
const SCORE_BADPOSE = 4; // 姿势差太多的分数阈值上限
const CONS_FAILED = 3; // 用户有关节消失的连续帧数后提示用户

class PoseScoring {
  // 动作评分模块，用于评估两个动作的相近程度，也就是用户动作和标准动作相比然后评分
  constructor(errorPenalty = DEFAULT_PENALTY) {
    this.scoreHistory = []; // 历史动作分数
    this.scoreTime = []; // 历史动作时间
    this.scoreCnt = 0; // 历史动作计数
    this.errorPenalty = errorPenalty; // 如果remotePosition出现了的部分，localPosition没有出现，则分数减少一个常量
    this.previousTimeIndex = 0; // 上一次前一秒查询平均分对应的索引
    this.failedCnt = 0; // 用户有关节消失的连续帧数（超过CONS_FAILED帧后提示用户）
    this.badPoseCnt = 0; // 姿势差太多的连续帧数（超过CONS_BADPOSE帧后提示用户）
  }

  transScore(localPose, remotePose, currentTime, videoPaused) {
    // 评分函数，返回动作相似度分数（瞬时值）
    // 输入：
    // localPose: 本地动作，结构：{keypoints: [{position: {x: number, y: number} },...] }
    // remotePose: 远程动作，结构：{keypoints: [{position: {x: number, y: number} },...] }
    // 返回对应的每两个关节之间的曼哈顿距离之和
    if (!localPose) {
      if (!remotePose) return 100; // 如果两者都不存在，则返回100
      return 0; // 如果localPose不存在，则返回0
    }
    const localKeypoints = localPose.keypoints;
    const remoteKeypoints = remotePose.keypoints;
    let hasDisappearedJoint = false; // 用户有关节消失的标志
    let errorX = {},
      errorY = {}, // 记录每个关节相对标准动作的误差
      minErrorX = Infinity,
      minErrorY = Infinity, // 用于消除统一偏移
      minY = Infinity,
      maxY = -Infinity,
      standardminY = Infinity,
      standardmaxY = -Infinity; // 检测用户的高度，提示用户靠近或远离摄像头（要和标准视频高度一致才能更好评分）
    for (let i = 0; i < localKeypoints.length; i++) {
      const localPoint = localKeypoints[i];
      const remotePoint = remoteKeypoints[i];
      // 如果remotePosition出现了的部分，localPosition没有出现，则分数减少一个常量
      if (!localPoint || !localPoint.x) {
        if (remotePoint) {
          errorX[i] = this.errorPenalty;
          errorY[i] = this.errorPenalty;
          hasDisappearedJoint = true;
        }
        continue;
      }
      minY = Math.min(minY, localPoint.y);
      maxY = Math.max(maxY, localPoint.y);
      standardminY = Math.min(standardminY, remotePoint.y);
      standardmaxY = Math.max(standardmaxY, remotePoint.y);
      errorX[i] = localPoint.x - remotePoint.x;
      errorY[i] = localPoint.y - remotePoint.y;
      if (Math.abs(errorX[i]) < minErrorX) minErrorX = errorX[i]; // 消除统一偏移，使用最小的量
      if (Math.abs(errorY[i]) < minErrorY) minErrorY = errorY[i];
    }
    let error = 0;
    for (let i = 0; i < localKeypoints.length; i++) {
      error +=
        Math.abs(errorX[i] - minErrorX) ** GAMMA +
        Math.abs(errorY[i] - minErrorY) ** GAMMA; // 计算曼哈顿距离之和
    }
    const score = Math.max(100 - error / ALPHA / localKeypoints.length, 1); // 归一化到1-100
    // 提醒用户全身入镜
    let tip = 0;
    if (score < SCORE_BADPOSE) this.badPoseCnt++;
    else this.badPoseCnt = 0;
    if (hasDisappearedJoint) {
      this.failedCnt++;
      if (this.failedCnt >= CONS_FAILED) {
        tip = 3; // 提醒用户全身入镜
      }
    } else {
      this.failedCnt = 0;
      // 提醒用户靠近或远离摄像头
      const heightDiff = (maxY - minY) / (standardmaxY - standardminY);
      if (heightDiff < FAR_TOLERANCE) {
        tip = 2; // 提醒用户靠近摄像头
      } else if (heightDiff > CLOSE_TOLERANCE) {
        tip = 1; // 提醒用户远离摄像头
      } else if (this.badPoseCnt >= CONS_BADPOSE) {
        tip = 4; // 提醒用户姿势差
      } else {
        tip = 0; // 清除提示
      }
    }
    if (videoPaused) return score; // 暂停时评分但是不计入总分
    // 处理分数前缀和
    if (this.scoreCnt == 0) {
      this.scoreHistory.push(score);
    } else {
      this.scoreHistory.push(score + this.scoreHistory[this.scoreCnt - 1]);
    }
    this.scoreTime.push(currentTime);
    this.scoreCnt++;
    return {
      score: score,
      tip: tip,
    };
  }

  averageScore(currentTime) {
    // 最近1s内的
    // 找到第一个大于等于currentTime的索引
    let index = 0;
    for (let i = this.previousTimeIndex; i < this.scoreTime.length; i++) {
      if (this.scoreTime[i] >= currentTime - 1000) {
        index = i;
        break;
      }
    }
    // 计算平均分
    this.previousTimeIndex = index;
    if (this.scoreCnt - index == 0) return 0;
    return (
      (this.scoreHistory[this.scoreCnt - 1] - this.scoreHistory[index]) /
      (this.scoreCnt - 1 - index)
    );
  }

  totalAverageScore() {
    // 所有历史动作的平均分
    return this.scoreHistory[this.scoreCnt - 1] / this.scoreCnt;
  }

  clear() {
    // 清空历史动作分数
    this.scoreHistory = [];
    this.scoreTime = [];
    this.scoreCnt = 0;
  }
}

const nameDict = {
  0: "nose",
  1: "left_eye",
  2: "right_eye",
  3: "left_ear",
  4: "right_ear",
  5: "left_shoulder",
  6: "right_shoulder",
  7: "left_elbow",
  8: "right_elbow",
  9: "left_wrist",
  10: "right_wrist",
  11: "left_hip",
  12: "right_hip",
  13: "left_knee",
  14: "right_knee",
  15: "left_ankle",
  16: "right_ankle",
};
class PoseCaching {
  // 动作缓存模块，用于缓存动作（标准动作视频）的姿态数据，减少计算量
  constructor() {
    this.poseList = [];
  }
  addPoses(poses) {
    // 缓存动作数据
    // 结构: [{keypoints: [{x: number, y: number, score: number, name: string},...], score: number}, ..., number(timestamp)]
    this.poseList.push([...poses, Date.now()]); // 记录时间戳
  }
  deflateObj(poseListObj) {
    // 压缩动作数据
    // 结构：[[{keypoints: [{x: number, y: number, score: number, name: string},...], score: number}],...]
    // 时间轴的开始就是第一帧最后一个元素（时间戳）
    const startTime = parseInt(poseListObj[0][poseListObj[0].length - 1]); // ms
    const deflatedObj = [];
    for (const poses of poseListObj) {
      const deflatedPoses = [];
      for (const pose of poses) {
        if (typeof pose === "number") {
          // 一定是最后一个才是时间戳，前面都是动作数据
          deflatedPoses.push(parseInt(pose - startTime)); // 压缩为整数，去掉过多的小数位（单位ms）
        } else {
          const deflatedPose = [];
          for (const keypoint of pose.keypoints) {
            deflatedPose.push(
              parseInt(keypoint.x),
              parseInt(keypoint.y),
              parseInt(keypoint.score * 100) / 100
            ); // 压缩为整数，去掉过多的小数位
            // 因为顺序固定，因此name可省略
          }
          deflatedPose.push(parseInt(pose.score * 100) / 100); // 压缩为整数，去掉过多的小数位
          deflatedPoses.push(deflatedPose);
        }
      }
      deflatedObj.push(deflatedPoses);
    }
    return deflatedObj; // 结构：[[[x1, y1, s1, x2, y2, s2, x3, y3, s3, ..., x17, y17, s17, score],...], ...]
  }
  getObj() {
    // 返回缓存的动作数据
    return this.deflateObj(this.poseList);
  }
  clear() {
    // 清空缓存
    this.poseList = [];
  }
}

class PoseFromCache {
  // 从缓存中读取动作数据，减少计算量（将PoseCaching的输出作为输入即可逐帧读取姿态数据）
  constructor(poseObj) {
    this.poseList = this.inflateObj(poseObj);
    this.poseLen = poseObj.length;
    this.progress = -1; // 读取进度
    this.startTime = 0;
  }
  inflateObj(deflatedObj) {
    // 解压动作数据
    // 结构：[[[x1, y1, s1, x2, y2, s2, x3, y3, s3, ..., x17, y17, s17, score],...], ...]
    const poseListObj = [];
    for (const deflatedPoses of deflatedObj) {
      const poses = [];
      for (const deflatedPose of deflatedPoses) {
        if (typeof deflatedPose === "number") {
          // 一定是最后一个才是时间戳，前面都是动作数据
          poses.push(deflatedPose);
        } else {
          const keypoints = [];
          for (let i = 0, index = 0; i < 51; i += 3, index++) {
            // 17个关键点，每个关键点有2个坐标和1个置信度
            const x = deflatedPose[i];
            const y = deflatedPose[i + 1];
            const score = deflatedPose[i + 2];
            keypoints.push({ y: y, x: x, score: score, name: nameDict[index] });
          }
          const score = deflatedPose[51];
          poses.push({ keypoints: keypoints, score: score });
        }
      }
      poseListObj.push(poses);
    }
    // 结构：[[{keypoints: [{x: number, y: number, score: number, name: string},...], score: number}],...]
    return poseListObj;
  }
  copyPoses(poses) {
    // 复制动作数据，防止源数据被修改
    const newPoses = [];
    for (const pose of poses) {
      const newPose = { keypoints: [], score: 0 };
      for (const keypoint of pose.keypoints) {
        newPose.keypoints.push({
          y: keypoint.y,
          x: keypoint.x,
          score: keypoint.score,
          name: keypoint.name,
        });
      }
      newPose.score = pose.score;
      newPoses.push(newPose);
    }
    return newPoses;
  }
  getPoses(currentTime = null) {
    // 注意是相对时间（ms）应当传入video.currentTime*1000
    if (this.progress >= this.poseLen) return [];
    if (!currentTime) {
      // 如果没有传入时间，则使用第一次调用的时间手动计时。但是这样一旦出现卡顿就会错位
      const timestamp = parseInt(Date.now()); // 记录当前时间（ms）
      if (this.progress == -1)
        (this.startTime = timestamp), (this.progress = 0); // 记录开始时间
      currentTime = timestamp - this.startTime; // 计算当前时间（ms）
    } else if (this.progress == -1) {
      this.progress = 0;
    } // 无需记录startTime，直接progress归零
    // 找到第一个大于等于currentTime的索引
    for (; this.progress < this.poseLen; this.progress++) {
      const currentPoses = this.poseList[this.progress]; // 当前帧的动作数据
      const currentPoseTime = currentPoses[currentPoses.length - 1]; // 当前帧的最后一个元素（时间戳）
      if (currentPoseTime >= currentTime)
        return this.copyPoses(currentPoses.slice(0, -1)); // 找到了，返回当前帧的动作数据（要去掉时间戳）
    }
    return []; // 时间已经超出结尾，返回空数组
  }
  reset() {
    // 重置读取进度
    this.progress = -1;
  }
}
