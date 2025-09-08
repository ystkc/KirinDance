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
  algorithm: "single-pose", // 姿态识别算法，single-pose或multi-pose
  input: {
    architecture: "ResNet50", // 姿态识别模型架构
    outputStride: 32, // 姿态识别模型输出步长，2的幂，越大越精细，但会增加计算量
    inputResolution: 200, // 姿态识别模型精度，200-900，越大越精细，但会增加计算量
    multiplier: 1,
    quantBytes: 2,
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1, // 最小姿态置信度，越高则越不容易在没人时误判为有人，但也容易无法及时发现人物或产生时有时无的问题
    // minPartConfidence: 0.5, // PosNet，最小关节点置信度，越高则越不容易将物体误判为关节，但越容易漏关节
    minPartConfidence: 0.3, // MoveNet的参数略低于PosNet，但效果更好
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
    showPoints: false, // 显示关节点（动态粉色实心圆点）
    showStandardTrack: true, // 显示标准轨迹（灰色半透明粗线条）
    showUserTrack: true, // 显示用户轨迹（黄色实线条）
    showStandardNodes: true, // 显示标准节点（静态的粉色、绿色和蓝色半透明圆点）
    showUserNodes: false, // 显示用户节点（静态的黄色半透明圆点）
    showScore: false, // 在每段用户轨迹中部显示评分（静态的黑色文字，整数）
  },
  net: null, // 姿态识别模型对象，null表示尚未加载完毕
}; // PosNet和MoveNet都在库中硬编码了从google云下载的模型，大约几十MB，国内需要魔法
// 我修改了pose-detection.min.js，将其中的所有https://tfhub.dev/删去，这样所有的资源都会从本域名加载(就是从本项目的google文件夹)

function toggleLoadingUI( // 显示或关闭加载中的文本元素
  showLoadingUI, loadingDivId = 'loading', mainDivId = 'main') {
if (showLoadingUI) {
  document.getElementById(loadingDivId).style.display = 'block';
  document.getElementById(mainDivId).style.display = 'flex';
} else {
  document.getElementById(loadingDivId).style.display = 'none';
  document.getElementById(mainDivId).style.display = 'flex';
}
}

export async function bindPage() {
  // 加载posnet模型
  toggleLoadingUI(true); // 显示模型加载中的提示
  // 以下所有标记PosNet:和MoveNet:的注释都是可以互相替换的，分别代表两种不同的姿态识别方案
  // PosNet:
  // const net = await posenet.load({
  //   architecture: guiState.input.architecture,
  //   outputStride: guiState.input.outputStride,
  //   inputResolution: guiState.input.inputResolution,
  //   multiplier: guiState.input.multiplier,
  //   quantBytes: guiState.input.quantBytes,
  // });
  // MoveNet:
  const model = poseDetection.SupportedModels.MoveNet;
  const detectorConfig = {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
  };
  const net = await poseDetection.createDetector(model, detectorConfig); // 异步下载
  toggleLoadingUI(false); // 关闭模型加载中的提示
  guiState.net = net; // 保存模型对象
}

bindPage(); // posenet模型需要联网加载，所以预先异步加载(无需等待DOM加载完成)

const width = 720; // 观察画面尺寸，注意要与源视频尺寸一致（不宜过大，显卡性能限制，不掉帧即可）
const height = 540;

let enabled_1 = false; // 标记运行状态
let mediaProcessor = null; // 用户摄像头画面处理模块，用于姿态识别和评分
let mediaRecorder = null; // 用户摄像头画面记录模块，用于回放教学和比对
let cameraStream = null; // 用户摄像头流，点击开始时初始化，结束时用于关闭摄像头

let round = 0; // 标记当前帧数，刚开始的几帧需要特殊处理
let waiting = 0; // 标记等待模型加载完毕的提示框是否已经显示

const example_video = "static/std64_fixed.mp4"; // 标准视频，建议简单背景，单人全身，使用适合web加载的视频格式，widthxheight的分辨率

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

  document.getElementById("stop").addEventListener("click", function () {
    // 点击停止按钮后的事件处理
    try {
      stopPlaying();
    } catch (e) {
      showError(e);
    }
  });

  document.getElementById("record").addEventListener("click", async function () {
    // 点击录制按钮后的事件处理
    try {
      startRecording();
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

async function startRecording() { // 开始录制（解析标准视频，不评分）
  if (enabled_1) return; // 要先停止才能切换录制和评分模式
  enabled_1 = true; // 标记正在运行
  setupFPS(); // 在左下角打开性能统计

  const remoteVideoCanvas = document.getElementById("remoteVideo");
  loadRemoteVideoCanvas(remoteVideoCanvas); // 配置远程视频（加载标准视频，用于教学和比对）

  const canvas = document.getElementById("remoteCanvas"); // 姿态识别画布
  const nodeCanvas = document.getElementById("remotePassiveCanvas"); // 节点画布
  const passiveCanvas = document.getElementById("remotePassiveCanvas"); // 用户轨迹画布（此函数中不会被使用）
  const skeletonCanvas = document.getElementById("remoteSkeletonCanvas"); // 骨架画布

  detectPoseInRealTime(remoteVideoCanvas, canvas, nodeCanvas, passiveCanvas, skeletonCanvas, true); // 主模块，用于姿态识别并评分
  // recording参数表示是否录制，true表示录制，false表示评分
}

const standardCompare = false;
async function startPlaying() {
  if (enabled_1) return; // 要先停止才能切换录制和评分模式
  enabled_1 = true; // 标记正在运行
  setupFPS(); // 在左下角打开性能统计

  const remoteVideoCanvas = document.getElementById("remoteVideo");
  loadRemoteVideoCanvas(remoteVideoCanvas); // 配置远程视频（加载标准视频，用于教学和比对）
  
  const canvas = document.getElementById("remoteCanvas"); // 姿态识别画布
  const nodeCanvas = document.getElementById("localNodeCanvas"); // 节点画布
  const passiveCanvas = document.getElementById("remotePassiveCanvas"); // 用户轨迹画布
  const skeletonCanvas = document.getElementById("localSkeletonCanvas"); // 骨架画布

  const userCameraCanvas = document.getElementById("localVideo");
  if (!standardCompare) {
    try {
      loadCameraCanvas(userCameraCanvas); // 配置用户的摄像头（打开并开始拍摄，但是还没有保存，也没有处理）
    } catch (e) {
      throw new Error("加载摄像头失败，请确认当前设备有摄像头：" + e.message);
    }
    detectPoseInRealTime(userCameraCanvas, canvas, nodeCanvas, passiveCanvas, skeletonCanvas, false, testData); // 主模块，用于姿态识别并评分
  } else {
    detectPoseInRealTime(remoteVideoCanvas, canvas, nodeCanvas, passiveCanvas, skeletonCanvas, false, testData);
  }

  // testData是先前用startRecording解析的结果，在html中通过js的形式载入
}

async function stopPlaying() {
  enabled_1 = false;
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");
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
  // stop the recorder
  if (mediaRecorder) {
    mediaRecorder.stop();
    mediaRecorder = null;
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
const testLocal = false;
async function loadCameraCanvas(userCameraCanvas) {
  if (testLocal) {
    userCameraCanvas.src = example_video; // 测试集：用本地文件代替用户摄像头
  } else {
    userCameraCanvas = await setupCamera(userCameraCanvas); // 打开摄像头
  }
  userCameraCanvas.style.opacity = 1;
  userCameraCanvas.width = videoWidth;
  userCameraCanvas.height = videoHeight;
  userCameraCanvas.play(); // 开始拍摄（但是还没有保存，也没有处理）
}

// 将画布连接到标准视频
async function loadRemoteVideoCanvas(remoteVideoCanvas) {
  remoteVideoCanvas.src = example_video;
  remoteVideoCanvas.style.opacity = 1;
  remoteVideoCanvas.width = videoWidth;
  remoteVideoCanvas.height = videoHeight;
}

// 姿态计算
function detectPoseInRealTime(video, canvas, nodeCanvas, passiveCanvas, skeletonCanvas, recording, standardData=null) {
  // 模型尚未加载完毕，或者用户摄像头还没准备好，则等待
  if (guiState.net == null || video.readyState !== video.HAVE_ENOUGH_DATA) {
    if (waiting == 0) {
      waiting = 1;
      showModal("模型正在加载，请稍后...", "提示"); // 展示提示框
    }
    setTimeout(() => {
      detectPoseInRealTime(video, canvas, nodeCanvas, passiveCanvas, skeletonCanvas, recording, standardData);
    }, 1000); // 1s后再次尝试
    return;
  }
  waiting = 0;
  hideAllModals(); // 关闭所有提示框

  const remoteVideo = document.getElementById("remoteVideo"); // 标准视频画布
  
  const skeletonCtx = skeletonCanvas.getContext("2d"); // 骨架画布上下文
  const progressBar = document.getElementById("progress"); // 进度条

  const flipPoseHorizontal = true; // 手动水平翻转(MoveNet没有内置这个功能)

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  nodeCanvas.width = videoWidth;
  nodeCanvas.height = videoHeight;
  passiveCanvas.width = videoWidth;
  passiveCanvas.height = videoHeight;
  skeletonCanvas.width = videoWidth;
  skeletonCanvas.height = videoHeight;
  round = 0; // 标记当前帧数，刚开始的几帧需要特殊处理
  // 初始化Action和ActionRecorder
  mediaProcessor = new Action(canvas, nodeCanvas, passiveCanvas, skeletonCanvas, guiState.output);
  if (!recording) mediaProcessor.pushData(standardData); // 标记当前是录制还是评分模式

  mediaRecorder = new ActionRecorder(skeletonCanvas);
  const posesQueue = []; // 储存最近len个pose，进行平滑抖动
  const posesQueueLength = 5; // 队列最大长度
  let posesQueuelen = 0; // 队列当前长度
  const singleMinPoseConfidence =
    guiState.singlePoseDetection.minPoseConfidence;
  const multiMinPoseConfidence = guiState.multiPoseDetection.minPoseConfidence;
  const singleMinPartConfidence =
    guiState.singlePoseDetection.minPartConfidence * posesQueueLength; // 直接用队列中所有置信度的和来比较，减少运算
  const multiMinPartConfidence =
    guiState.multiPoseDetection.minPartConfidence * posesQueueLength;
  const keypointsLength = 17; // 关键点数量

  function flipHorizontal(poses) {
    // 手动水平翻转(MoveNet没有内置这个功能)
    poses.forEach((pose) => {
      pose.keypoints.forEach((keypoint) => {
        keypoint.x = videoWidth - keypoint.x; // 至于为何要乘0.75(画框和原视频比例)，暂时不清楚
        keypoint.y = keypoint.y;
      });
    });
  }

  async function singlePoseDetectionFrame() {
    stats.end();
    stats.begin();
    // 如果视频尚未准备好，则不进行检测
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(singlePoseDetectionFrame);
      return;
    }
    // PosNet:
    // const poses = await guiState.net.estimatePoses(video, {
    //   flipHorizontal: flipPoseHorizontal,
    //   decodingMethod: "single-person",
    // });
    // MoveNet:
    const poses = await guiState.net.estimatePoses(video);
    if (flipPoseHorizontal) {
      // 手动水平翻转(MoveNet没有内置这个功能)
      flipHorizontal(poses);
    }

    if (poses.length > 0 && poses[0].score >= singleMinPoseConfidence)
      poseProcessingFrame(
        singlePoseDetectionFrame,
        poses[0],
        singleMinPartConfidence
      );
    else requestAnimationFrame(singlePoseDetectionFrame);
  }

  async function multiPoseDetectionFrame() {
    // 该函数未测试
    stats.end();
    stats.begin();
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(multiPoseDetectionFrame);
      return;
    }
    // PosNet:
    // const poses = await guiState.net.estimatePoses(video, {
    //   flipHorizontal: flipPoseHorizontal,
    //   decodingMethod: "multi-person",
    //   maxDetections: guiState.multiPoseDetection.maxPoseDetections,
    //   scoreThreshold: multiMinPartConfidence,
    //   nmsRadius: guiState.multiPoseDetection.nmsRadius,
    // });
    // MoveNet:
    const poses = await guiState.net.estimatePoses(video, {
      flipHorizontal: flipPoseHorizontal,
      maxDetections: guiState.multiPoseDetection.maxPoseDetections,
      scoreThreshold: multiMinPartConfidence,
      nmsRadius: guiState.multiPoseDetection.nmsRadius,
    });
    if (flipPoseHorizontal) {
      // 手动水平翻转(MoveNet没有内置这个功能)
      flipHorizontal(poses);
    }

    // 由于需要平滑波动防止偶然的关节消失，因此即便part没有超过阈值，也要传入
    if (poses.length > 0 && poses[0].score >= multiMinPoseConfidence)
      poseProcessingFrame(
        multiPoseDetectionFrame,
        poses[0],
        multiMinPartConfidence
      );
    else requestAnimationFrame(multiPoseDetectionFrame);
  }

  async function poseProcessingFrame(handle, pose, minPartConfidence) {
    // 由handle来控制单人还是多人
    skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
    let keypoints = pose.keypoints;
    // 平滑抖动模块
    // 记录动作，并计算前缀和
    // Pfs = Prefix Sum
    const prevWeightedKeypointsPfs =
      posesQueuelen > 0 ? posesQueue[posesQueuelen - 1] : undefined; // 前一帧的动作位置的前缀和
    const weightedKeypointsPfs = [];
    for (let i = 0; i < keypointsLength; i++) {
      // PosNet:
      // const position = keypoints[i].position;
      // const score = keypoints[i].score;
      // MoveNet:
      const position = keypoints[i];
      const score = position.score;
      try {
        weightedKeypointsPfs.push({
          // 添加每个关节的位置，按照置信度加权，然后计算关节的加权位置前缀和
          x: position.x * score + prevWeightedKeypointsPfs[i].x,
          y: position.y * score + prevWeightedKeypointsPfs[i].y,
          score: score + prevWeightedKeypointsPfs[i].score,
        });
      } catch (e) {
        // 第一次没有前缀和
        weightedKeypointsPfs.push({
          x: position.x * score,
          y: position.y * score,
          score: score,
        });
      }
    }
    posesQueue.push(weightedKeypointsPfs); // 添加最新的一帧
    if (posesQueuelen == posesQueueLength) posesQueue.shift();
    else posesQueuelen++; // 删掉最旧的一帧

    round++;
    if (round == 1) {
      mediaProcessor.startDrawing(pose, Date.now()); // 第一帧特殊处理
      remoteVideo.play(); // 开始播放（因为摄像头一般加载较慢，所以要先加载好摄像头再播放）
    } else {
      // 产生平滑后的动作位置
      const B = weightedKeypointsPfs; // 前缀和的末尾
      const A = posesQueue[0]; // 前缀和的开头
      const weightedKeypoints = []; // 平滑后的动作位置（不是前缀和了）
      for (let i = 0; i < keypointsLength; i++) {
        const score = B[i].score - A[i].score; // 这一串动作的这个关节的置信度之和
        // 如果这个关节的置信度之和小于阈值（阈值已经乘以队列长度），则不画出来
        if (score < minPartConfidence)
          weightedKeypoints.push({ position: { x: null, y: null } });
        else
          weightedKeypoints.push({
            position: {
              x: (B[i].x - A[i].x) / score, // 每个位置都乘以了自己的置信度再相加，这里只需要除以总的置信度就能得到位置的平均值
              y: (B[i].y - A[i].y) / score,
            },
          });
      }

      // tracker: 跟踪连续动作的两种模式
      if (recording) {
        // 正在录制传入的frame并解析其中的动作
        mediaProcessor.draw({ keypoints: weightedKeypoints }, Date.now());
      } else {
        // 正在解析动作并评分
        // 检测weightedKeypoints中是否有0：
        let hasZero = false;
        for (let i = 0; i < keypointsLength; i++) {
          if (weightedKeypoints[i].position.x === 0 && weightedKeypoints[i].position.y === 0) {
            hasZero = true;
            console.log("检测到0");
            break;
          }
        }
        const actionScore = mediaProcessor.passiveDraw(
          { keypoints: weightedKeypoints },
          Date.now()
        );
        if (actionScore !== 0) {
          document.getElementById(
            "score"
          ).textContent = `得分：${actionScore.toFixed(2)}`;
        }
      }

      // 如果视频结束，则停止录制

      if (remoteVideo.ended) {
        mediaProcessor.endDrawing(Date.now());
        return;
      }
    }
    requestAnimationFrame(handle); // continue looping
  }

  switch (guiState.algorithm) { // 根据配置中的算法运行相应的姿态检测函数
    case "single-pose":
      singlePoseDetectionFrame();
      break;
    case "multi-pose":
      multiPoseDetectionFrame();
      break;
    default:
      throw new Error(`Unsupported algorithm: ${guiState.algorithm}`);
  }
}
