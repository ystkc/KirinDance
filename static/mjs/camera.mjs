/**
 * @license
 * Modifications Copyright 2025 Cereanilla/SYSU SIC. All Rights Reserved.
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

const guiState = {
  // 姿态识别参数设置和对象保存
  algorithm: "multi-pose", // 姿态识别算法，single-pose或multi-pose
  input: {
    // PosNet的ResNet50/MobileNetV1
    architecture: "MobileNetV1", // 姿态识别模型架构
    outputStride: 8, // 姿态识别模型输出步长，2的幂，越大越精细，但会增加计算量
    inputResolution: 200, // 姿态识别模型精度，200-900，越大越精细，但会增加计算量
    multiplier: 0.75,
    quantBytes: 2,
  },
  moveNetInput: {
    // MoveNet
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1, // 最小姿态置信度，越高则越不容易在没人时误判为有人，但也容易无法及时发现人物或产生时有时无的问题
    // minPartConfidence: 0.5, // PosNet，最小关节点置信度，越高则越不容易将物体误判为关节，但越容易漏关节
    minPartConfidence: 0.1, // MoveNet的参数略低于PosNet，但效果更好
  },
  multiPoseDetection: {
    maxPoseDetections: 5, // 最多识别人数
    minPoseConfidence: 0.15, // 同上，越高则越不容易将物体误判为人，但也越容易漏掉人物
    minPartConfidence: 0.1, // 同上
    nmsRadius: 30.0, // 非极大值抑制半径，越大则越不容易将相似的姿态合并
  },
  output: {
    // 辅助图形配置
    showSkeletons: true, // 显示骨架（黑色折线）
    showPoints: true, // 显示关节点（动态粉色实心圆点）
    showStandardTrack: true, // 显示标准轨迹（灰色半透明粗线条）
    showUserTrack: true, // 显示用户轨迹（黄色实线条）
    showStandardNodes: true, // 显示标准节点（静态的粉色、绿色和蓝色半透明圆点）
    showUserNodes: false, // 显示用户节点（静态的黄色半透明圆点）
    showScore: false, // 在每段用户轨迹中部显示评分（静态的黑色文字，整数）
  },
  net: null, // 姿态识别模型对象，null表示尚未加载完毕
}; // PosNet和MoveNet都在库中硬编码了从google云下载的模型，大约几十MB，国内需要魔法
// 我修改了pose-detection.min.js，将其中的所有https://tfhub.dev/删去，这样所有的资源都会从本域名加载(就是从本项目的google文件夹)
let flipPoseHorizontal = true; // 手动水平翻转(因为是前置摄像头，所以要手动翻转)
// usePoseNet变量，在index.html中定义，使用poseNet还是MoveNet，默认使用MoveNet

function toggleLoadingUI( // 显示或关闭加载中的文本元素
  showLoadingUI,
  loadingDivId = "loading",
  mainDivId = "main"
) {
  if (showLoadingUI) {
    document.getElementById(loadingDivId).style.display = "block";
    document.getElementById(mainDivId).style.display = "flex";
  } else {
    document.getElementById(loadingDivId).style.display = "none";
    document.getElementById(mainDivId).style.display = "flex";
  }
}

export async function bindPage() {
  // 加载posnet模型
  toggleLoadingUI(true); // 显示模型加载中的提示
  // 以下所有标记PosNet:和MoveNet:的注释都是可以互相替换的，分别代表两种不同的姿态识别方案
  let net;
  if (usePoseNet) {
    net = await posenet.load({
      architecture: guiState.input.architecture,
      outputStride: guiState.input.outputStride,
      inputResolution: guiState.input.inputResolution,
      multiplier: guiState.input.multiplier,
      quantBytes: guiState.input.quantBytes,
    });
  } else {
    // MoveNet:
    const model = poseDetection.SupportedModels.MoveNet;
    const detectorConfig = {
      modelType: guiState.moveNetInput.modelType,
    };
    net = await poseDetection.createDetector(model, detectorConfig); // 异步下载
  }
  toggleLoadingUI(false); // 关闭模型加载中的提示
  guiState.net = net; // 保存模型对象
}

bindPage(); // posenet模型需要联网加载，所以预先异步加载(无需等待DOM加载完成)

const width = 720; // 观察画面尺寸，注意要与源视频尺寸一致（不宜过大，显卡性能限制，不掉帧即可）
const height = 540;

let enabled_1 = false; // 标记运行状态
let halt = false; // 标记用户是否手动停止了播放视频
let cameraStream = null; // 用户摄像头流，点击开始时初始化，结束时用于关闭摄像头

let round = -1; // 标记当前rAF轮数，刚开始的一轮需要特殊处理（-1未开始或已结束，0准备中）
let waiting = 0; // 标记等待模型加载完毕的提示框是否已经显示

// 标准视频在index.html中定义，建议简单背景，单人全身，使用适合web加载的视频格式，widthxheight的分辨率

const videoWidth = width;
const videoHeight = height;
const stats = new Stats(); // 性能统计模块

function setupFPS() {
  // 性能统计(FPS、渲染间隔、内存占用)
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.querySelector(".fpsbox").appendChild(stats.domElement);
}
function closeFPS() {
  stats.domElement.remove();
}

navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia; // 兼容性处理

window.onload = function () {
  document.getElementById("start").addEventListener("click", async function () {
    // 点击开始按钮后的事件处理
    try {
      // 将错误信息通过模块显示
      startPlaying();
    } catch (e) {
      showError(e);
    }
  });

  document.getElementById("pause").addEventListener("click", function () {
    // 点击暂停按钮后的事件处理
    try {
      const remoteVideo = document.getElementById("remoteVideo");
      if (remoteVideo.paused) {
        remoteVideo.play();
      } else {
        remoteVideo.pause();
      }
    } catch (e) {
      showError(e);
    }
  });

  document.getElementById("stop").addEventListener("click", function () {
    // 点击停止按钮后的事件处理
    try {
      stopPlaying();
    } catch (e) {
      showError(e);
    }
  });

  document.getElementById("cache").addEventListener("click", function () {
    // 点击缓存按钮后的事件处理
    try {
      // 缓存数据，用于比对
      startCaching();
    } catch (e) {
      showError(e);
    }
  });
};

async function showError(error) {
  let info = document.getElementById("info");
  info.textContent = `出现错误：${error.message} 详细信息：${error.stack}`;
  info.style.display = "block";
  info.style.color = "red";
  throw error;
}

const standardCompare = false; // 标准对照模式，将标准视频当成用户输入，用于测试算法是否能正确评分
async function startPlaying() {
  if (enabled_1) return; // 要先停止才能切换录制和评分模式
  enabled_1 = true; // 标记正在运行
  setupFPS(); // 在左下角打开性能统计

  const remoteVideo = document.getElementById("remoteVideo");
  loadRemoteVideo(remoteVideo); // 配置远程视频（加载标准视频，用于教学和比对）

  const leftSkeletonCanvas = document.getElementById("localSkeletonCanvas"); // 骨架画布
  const rightSkeletonCanvas = document.getElementById("remoteSkeletonCanvas"); // 骨架画布

  const userCameraCanvas = document.getElementById("localVideo");
  if (!standardCompare) {
    try {
      loadCameraCanvas(userCameraCanvas); // 配置用户的摄像头（打开并开始拍摄，但是还没有保存，也没有处理）
    } catch (e) {
      throw new Error("加载摄像头失败，请确认当前设备有摄像头：" + e.message);
    }
    detectPoseInRealTime(
      userCameraCanvas,
      remoteVideo,
      leftSkeletonCanvas,
      rightSkeletonCanvas,
      remoteCache // 在HTML中通过script标签加载的静态缓存数据。目前只有一个视频，就不做另外的逻辑了
    ); // 主模块，用于姿态识别并评分
  } else {
    loadRemoteVideo(userCameraCanvas); // 配置用户的摄像头（加载标准视频，用于教学和比对）
    userCameraCanvas.parentNode.classList.remove("flip"); // 标准对照模式使用视频而不是前置摄像头，需要取消反转
    flipPoseHorizontal = false; // 标准对照模式不需要手动翻转
    detectPoseInRealTime(
      userCameraCanvas,
      remoteVideo,
      leftSkeletonCanvas,
      rightSkeletonCanvas,
      remoteCache
    );
  }
}

async function startCaching() {
  // 缓存数据，用于比对
  if (enabled_1) return; // 要先停止才能切换录制和评分模式
  enabled_1 = true; // 标记正在运行
  setupFPS(); // 在左下角打开性能统计
  const remoteVideo = document.getElementById("remoteVideo");
  loadRemoteVideo(remoteVideo); // 配置远程视频（加载标准视频，用于计算姿态并缓存）

  calcCacheInRealTime(remoteVideo);
}

async function stopPlaying() {
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
  if (round > -1) {
    halt = true; // 停止远程视频播放，先停止detect pose
    return;
  }
  halt = false;
  enabled_1 = false;
  closeFPS();
  // stop the message source
  if (remoteVideo.src) {
    // 是个链接，需要清除
    remoteVideo.setAttribute("src", "");
    remoteVideo.style.opacity = 0;
    localVideo.setAttribute("src", "");
    localVideo.style.opacity = 0;
  }
  // close the camera
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

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

// 打开摄像头
async function setupCamera(cameraCanvas) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "Browser API navigator.mediaDevices.getUserMedia not available"
    );
  }

  cameraCanvas.width = videoWidth;
  cameraCanvas.height = videoHeight;

  const mobile = isMobile();
  cameraStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined : videoHeight,
    },
  });
  cameraCanvas.srcObject = cameraStream;

  return new Promise((resolve) => {
    cameraCanvas.onloadedmetadata = () => {
      resolve(cameraCanvas);
    };
  });
}

// 将画布连接到用户摄像头
async function loadCameraCanvas(userCameraCanvas) {
  userCameraCanvas = await setupCamera(userCameraCanvas); // 打开摄像头
  userCameraCanvas.style.opacity = 1;
  userCameraCanvas.width = videoWidth;
  userCameraCanvas.height = videoHeight;
  userCameraCanvas.play(); // 开始拍摄（但是还没有保存，也没有处理）
}

// 将画布连接到标准视频
async function loadRemoteVideo(remoteVideo) {
  remoteVideo.src = example_video;
  remoteVideo.load();
  remoteVideo.style.opacity = 1;
  remoteVideo.width = videoWidth;
  remoteVideo.height = videoHeight;
}

const seg = [
  // 关节连接关系，两两链接
  5, 6, 5, 7, 5, 11, 7, 9, 6, 8, 6, 12, 8, 10, 11, 13, 13, 15, 12, 14, 14, 16,
  11, 12,
];
const segCnt = 12; // 肢体段数
const pointCnt = 17; // 关节点数
function drawSkeletons(pose, skeletonCtx, poseConf, partConf) {
  // pose结构: {keypoints: [{position: {x: number, y: number}, score: number},...], score: number}
  // 绘制人体骨骼
  if (pose.score < poseConf) return; // 姿态置信度不够，不画
  const keypoints = pose.keypoints;
  if (guiState.output.showSkeletons) {
    skeletonCtx.beginPath();
    for (let i = 0; i < segCnt; i++) {
      // 遍历每一段肢体
      const start = seg[i << 1]; // 开始关节
      const end = seg[(i << 1) | 1]; // 结束关节
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
  if (guiState.output.showPoints) {
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

function standardize(poses) {
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

async function singlePoseEstimate(video) {
  // 单人姿态识别
  // PosNet:
  if (usePoseNet) {
    return standardize(await guiState.net.estimatePoses(video, {
      decodingMethod: "single-person",
    }));
  } else {
    // MoveNet:
    return await guiState.net.estimatePoses(video);
  }
}

async function multiPoseEstimate(video) {
  // 多人姿态识别
  // PosNet:
  if (usePoseNet) {
    return standardize(await guiState.net.estimatePoses(video, {
      decodingMethod: "multi-person",
      maxDetections: guiState.multiPoseDetection.maxPoseDetections,
      scoreThreshold: guiState.multiPoseDetection.minPartConfidence,
      nmsRadius: guiState.multiPoseDetection.nmsRadius,
    }));
  } else {
    // MoveNet:（注意，MoveNet不能检测多人，只会返回一个长度的数组）
    return await guiState.net.estimatePoses(video, {
      maxDetections: guiState.multiPoseDetection.maxPoseDetections,
      scoreThreshold: guiState.multiPoseDetection.minPartConfidence,
      nmsRadius: guiState.multiPoseDetection.nmsRadius,
    });
  }
}

function chkNotReady(video) {
  return video.readyState !== video.HAVE_ENOUGH_DATA;
}

function flipHorizontal(poses) {
  // 手动水平翻转(MoveNet没有内置这个功能)
  poses.forEach((pose) => {
    pose.keypoints.forEach((keypoint) => {
      keypoint.x = videoWidth - keypoint.x; // 至于为何要乘0.75(画框和原视频比例)，暂时不清楚
      keypoint.y = keypoint.y;
    });
  });
}

// 姿态计算
function detectPoseInRealTime(
  localCamera,
  remoteVideo,
  localSkeletonCanvas,
  remoteSkeletonCanvas,
  remotePoseCache = null // 如果有远程视频缓存，则传入。如果没有，则生成缓存
) {
  // 模型尚未加载完毕，或者用户摄像头还没准备好，则等待
  if (
    guiState.net == null ||
    chkNotReady(localCamera) ||
    chkNotReady(remoteVideo)
  ) {
    if (waiting == 0) {
      waiting = 1;
      showModal("模型正在加载，请稍候...", "提示"); // 展示提示框
    }
    setTimeout(() => {
      detectPoseInRealTime(
        localCamera,
        remoteVideo,
        localSkeletonCanvas,
        remoteSkeletonCanvas,
        remotePoseCache
      );
    }, 1000); // 1s后再次尝试
    return;
  }
  waiting = 0;
  hideAllModals(); // 关闭所有提示框

  const localSkeletonCtx = localSkeletonCanvas.getContext("2d");
  const remoteSkeletonCtx = remoteSkeletonCanvas.getContext("2d");

  const progressBar = document.getElementById("progress"); // 进度条
  const scoreText = document.getElementById("score"); // 评分显示
  const disp = setInterval(() => {
    scoreText.textContent = `得分：${poseScoring
      .averageScore(Date.now())
      .toFixed(2)}`; // 显示评分
    if (remoteVideo.paused) scoreText.textContent += " (暂停)"; // 显示暂停状态
    const progress = remoteVideo.currentTime / remoteVideo.duration;
    if (!isNaN(progress)) progressBar.value = progress; // 进度条
    if (remoteVideo.ended || halt || round == -1) endDetect(); // 视频播放结束，结束姿态检测（防止这玩意漏掉了，补丁）
  }, 1000); // 1s更新一次

  localSkeletonCanvas.width = videoWidth;
  localSkeletonCanvas.height = videoHeight;
  remoteSkeletonCanvas.width = videoWidth;
  remoteSkeletonCanvas.height = videoHeight;

  localSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
  localSkeletonCtx.lineWidth = 16;
  localSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节
  remoteSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
  remoteSkeletonCtx.lineWidth = 16;
  remoteSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节

  round = 0; // 标记当前帧数，刚开始的几帧需要特殊处理

  const posesQueueLength = 5; // 队列最大长度

  const poseScoring = new PoseScoring(); // 动作评分模块
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
    guiState.algorithm // 根据配置中的算法运行相应的姿态检测函数
  ) {
    case "single-pose":
      localPoseWeighting = new PoseWeighting(
        posesQueueLength,
        guiState.singlePoseDetection.minPartConfidence
      );
      remotePoseWeighting = new PoseWeighting(
        posesQueueLength,
        guiState.singlePoseDetection.minPartConfidence
      );
      poseConf = guiState.singlePoseDetection.minPoseConfidence;
      partConf = guiState.singlePoseDetection.minPartConfidence;
      singlePoseDetectionFrame();
      break;
    case "multi-pose":
      localPoseWeighting = new PoseWeighting(
        posesQueueLength,
        guiState.multiPoseDetection.minPartConfidence
      );
      remotePoseWeighting = new PoseWeighting(
        posesQueueLength,
        guiState.multiPoseDetection.minPartConfidence
      );
      poseConf = guiState.multiPoseDetection.minPoseConfidence;
      partConf = guiState.multiPoseDetection.minPartConfidence;
      multiPoseDetectionFrame();
      break;
    default:
      throw new Error(`Unsupported algorithm: ${guiState.algorithm}`);
  }

  function endDetect() {
    clearInterval(disp);
    // 显示最终平均分
    let finalScore = poseScoring.totalAverageScore(),
      remark;
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
    poseScoring.clear(); // 清空动作评分
    localPoseWeighting.clear(); // 清空动作加权
    remotePoseWeighting.clear(); // 清空动作加权
    round = -1; // 标志rAF已停止
    stopPlaying(); // 停止播放
    if (!remotePoseCache) {
      console.log(remotePoseCaching.getObj()); // 输出缓存
    } else {
      remotePoseFromCache.reset(); // 重置加载的缓存（虽然目前还不会再次使用）
    }
  }

  async function singlePoseDetectionFrame() {
    stats.end();
    stats.begin();
    // 如果视频尚未准备好，则不进行检测
    if (chkNotReady(localCamera) || chkNotReady(remoteVideo)) {
      requestAnimationFrame(singlePoseDetectionFrame);
      return;
    }
    const localPoses = await singlePoseEstimate(localCamera);
    let p;
    if (remotePoseFromCache) {
      p = remotePoseFromCache.getPoses(remoteVideo.currentTime * 1000); // 从缓存中获取远程视频姿态数据
    } else {
      p = await singlePoseEstimate(remoteVideo);
      remotePoseCaching.addPoses(p); // 缓存远程视频姿态数据
    }
    const remotePoses = p;

    if (flipPoseHorizontal) {
      // 手动水平翻转（因为是前置摄像头，所以需要手动翻转）
      flipHorizontal(localPoses);
    }

    if (remotePoses.length > 0 && remotePoses[0].score >= poseConf)
      poseProcessingFrame(
        singlePoseDetectionFrame,
        localPoses[0],
        remotePoses[0]
      );
    else requestAnimationFrame(singlePoseDetectionFrame);
  }

  async function multiPoseDetectionFrame() {
    // 该函数未测试
    stats.end();
    stats.begin();
    if (chkNotReady(localCamera) || chkNotReady(remoteVideo)) {
      requestAnimationFrame(multiPoseDetectionFrame);
      return;
    }
    const localPoses = await multiPoseEstimate(localCamera);
    let p;
    if (remotePoseFromCache) {
      p = remotePoseFromCache.getPoses(remoteVideo.currentTime * 1000); // 从缓存中获取远程视频姿态数据
    } else {
      p = await multiPoseEstimate(remoteVideo);
      remotePoseCaching.addPoses(p); // 缓存远程视频姿态数据
    }
    const remotePoses = p;

    if (flipPoseHorizontal) {
      // 手动水平翻转(是用户相机要翻转，因为是前置)
      flipHorizontal(localPoses);
    }

    // 由于需要平滑波动防止偶然的关节消失，因此即便part没有超过阈值，也要传入
    if (remotePoses.length > 0 && remotePoses[0].score >= poseConf)
      poseProcessingFrame(
        multiPoseDetectionFrame,
        localPoses[0],
        remotePoses[0]
      );
    else requestAnimationFrame(multiPoseDetectionFrame);
  }

  async function poseProcessingFrame(handle, initLocalPose, initRemotePose) {
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
      drawSkeletons(localPose, localSkeletonCtx, poseConf, partConf); // 画本地骨骼
    if (remotePose)
      drawSkeletons(remotePose, remoteSkeletonCtx, poseConf, partConf);
    // 画标准视频骨骼
    else {
      requestAnimationFrame(handle); // remote中没有检测到人，直接跳过这一帧
      return;
    }

    round++;
    if (round == 1) {
      localCamera.play();
      remoteVideo.play(); // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
    } else {
      const transScore = poseScoring.transScore(
        localPose,
        remotePose,
        Date.now(),
        remoteVideo.paused
      ); // 记录本地动作
      // console.log(localPose, remotePose, transScore);
    }
    // 如果结束了，清除定时器
    if (remoteVideo.ended || halt) {
      endDetect();
    } else {
      requestAnimationFrame(handle); // continue looping
    }
  }
}

let displayCache = false;
function calcCacheInRealTime(remoteVideo) {
  // 计算远程视频的姿态缓存（本函数使用了requestVideoFrameCallback，目前不能在火狐浏览器中运行）
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
    alert("您的浏览器不支持requestVideoFrameCallback");
    return;
  }
  if (guiState.net == null || chkNotReady(remoteVideo)) {
    if (waiting == 0) {
      waiting = 1;
      showModal("模型正在加载，请稍候...", "提示"); // 展示提示框
    }
    setTimeout(() => {
      calcCacheInRealTime(remoteVideo);
    }, 1000); // 1s后再次尝试
    return;
  }
  displayCache = confirm("缓存过程是否渲染到屏幕上？（如果设备性能不好，请不要渲染）");
  waiting = 0;
  hideAllModals(); // 关闭所有提示框

  const remoteSkeletonCanvas = document.getElementById("remoteSkeletonCanvas");
  remoteSkeletonCanvas.width = videoWidth;
  remoteSkeletonCanvas.height = videoHeight;
  const remoteSkeletonCtx = remoteSkeletonCanvas.getContext("2d");
  remoteSkeletonCtx.strokeStyle = "rgba(0, 0, 0, 0.5)"; // 肢体
  remoteSkeletonCtx.lineWidth = 16;
  remoteSkeletonCtx.fillStyle = "rgba(238, 130, 238, 0.6)"; // 关节

  round = 0; // rAF轮数

  const remotePoseCaching = new PoseCaching(); // 远程视频姿态数据缓存模块

  const progressBar = document.getElementById("progress"); // 进度条
  const disp = setInterval(() => {
    // 缓存时不显示评分
    const progress = remoteVideo.currentTime / remoteVideo.duration;
    if (!isNaN(progress)) progressBar.value = progress; // 进度条
    if (remoteVideo.ended) {
      endCache();
    }
  }, 1000); // 1s更新一次

  // requestVideoframeCallback需要先播放才能被调用（这一点和rAF不同！）所以一开始必须手动调用
  switch (guiState.algorithm) {
    case "single-pose":
      singlePoseCacheFrame(0, {});
      break;
    case "multi-pose":
      multiPoseCacheFrame(0, {});
      break;
    default:
      throw new Error(`Unsupported algorithm: ${guiState.algorithm}`);
  }
  remoteVideo.play();

  function endCache() {
    clearInterval(disp);
    console.log(remotePoseCaching.getObj()); // 输出缓存
    showModal("缓存完成，请前往控制台查看。", "缓存完成");
  }

  async function singlePoseCacheFrame(now, metadata) {
    stats.end();
    stats.begin();
    if (chkNotReady(remoteVideo)) {
      // 视频没准备好，或缓存迅速而视频帧率较低，则跳过
      setTimeout(() => {
        singlePoseCacheFrame(now, metadata);
      }, 100);
      return;
    }
    const poses = await singlePoseEstimate(remoteVideo);
    remotePoseCaching.addPoses(poses); // 缓存远程视频姿态数据

    // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
    if (round == 0) {
      remoteVideo.play();
    }
    round++;
    if (remoteVideo.ended) endCache(); // 视频播放结束，结束姿态检测
    else remoteVideo.requestVideoFrameCallback(singlePoseCacheFrame); // 最后一帧不会被调用，不能在这里检测ended（额，这是bug吧？）
  }

  async function multiPoseCacheFrame(now, metadata) {
    // 该函数未测试
    stats.end();
    stats.begin();
    if (chkNotReady(remoteVideo)) {
      setTimeout(() => {
        multiPoseCacheFrame(now, metadata);
      }, 100);
      return;
    }
    const poses = await multiPoseEstimate(remoteVideo);
    remotePoseCaching.addPoses(poses); // 缓存远程视频姿态数据

    if (displayCache) {
      console.log(poses);
      remoteSkeletonCtx.clearRect(
        0,
        0,
        remoteSkeletonCanvas.width,
        remoteSkeletonCanvas.height
      );
      for (const pose of poses)
        drawSkeletons(
          pose,
          remoteSkeletonCtx,
          guiState.multiPoseDetection.minPoseConfidence,
          guiState.multiPoseDetection.minPartConfidence
        );
    }

    // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
    if (round == 0) {
      remoteVideo.play();
    }
    round++;
    if (remoteVideo.ended) endCache(); // 视频播放结束，结束姿态检测
    else remoteVideo.requestVideoFrameCallback(multiPoseCacheFrame); // 最后一帧不会被调用，不能在这里检测ended（额，这是bug吧？）
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
      const  keypoint = keypoints[i], score = keypoint.score;
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

const ALPHA = 4;
const BETA = 1;
const GAMMA = 1;

// 4 1 1
// 3000 1 2
const DEFAULT_PENALTY = ALPHA * 50;

class PoseScoring {
  // 动作评分模块，用于评估两个动作的相近程度，也就是用户动作和标准动作相比然后评分
  constructor(errorPenalty = DEFAULT_PENALTY) {
    this.scoreHistory = []; // 历史动作分数
    this.scoreTime = []; // 历史动作时间
    this.scoreCnt = 0; // 历史动作计数
    this.errorPenalty = errorPenalty; // 如果remotePosition出现了的部分，localPosition没有出现，则分数减少一个常量
    this.previousTimeIndex = 0; // 上一次前一秒查询平均分对应的索引
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
    let errorX = {},
      errorY = {},
      minErrorX = Infinity,
      minErrorY = Infinity;
    for (let i = 0; i < localKeypoints.length; i++) {
      const localPoint = localKeypoints[i];
      const remotePoint = remoteKeypoints[i];
      // 如果remotePosition出现了的部分，localPosition没有出现，则分数减少一个常量
      if (!localPoint || !localPoint.x) {
        if (remotePoint)
          (errorX[i] = this.errorPenalty), (errorY[i] = this.errorPenalty);
        continue;
      }
      errorX[i] = localPoint.x - remotePoint.x;
      errorY[i] = localPoint.y - remotePoint.y;
      if (Math.abs(errorX[i]) < minErrorX) minErrorX = errorX[i]; // 消除统一偏移，使用最小的量
      if (Math.abs(errorY[i]) < minErrorY) minErrorY = errorY[i];
    }
    let error = 0;
    for (let i = 0; i < localKeypoints.length; i++) {
      error +=
        (Math.abs(errorX[i] - minErrorX)*BETA) ** GAMMA + (Math.abs(errorY[i] - minErrorY)*BETA) ** GAMMA; // 计算曼哈顿距离之和
    }
    const score = Math.max(100 - error / ALPHA / localKeypoints.length, 1); // 归一化到1-100
    if (videoPaused) return score; // 暂停时评分但是不计入总分
    // 处理分数前缀和
    if (this.scoreCnt == 0) {
      this.scoreHistory.push(score);
    } else {
      this.scoreHistory.push(score + this.scoreHistory[this.scoreCnt - 1]);
    }
    this.scoreTime.push(currentTime);
    this.scoreCnt++;
    return score;
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
