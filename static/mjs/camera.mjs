/**
 * @license
 * Modifications Copyright 2025 Cereanilla/SYSU SIC. All Rights Reserved.
 *
 *    NOTICES FROM ORIGINAL PROJECT:
 *    Original Project: https://github.com/tensorflow/tfjs-models/tree/master/pose-detection
 *    Original Demo: https://storage.googleapis.com/tfjs-models/demos/posenet/camera.html
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

function initCamera() {
  if (socket == null || !socket.connected) {
    socket = new WebSocket(`ws://${location.host}/ws`);
    send_ws_msg("start");
  }
  // check if the camera is available
  if (!localVideo.srcObject || !localVideo.srcObject.active) {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        mediaStream = stream;
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "video/webm; codecs=vp9", // 可以根据需要调整 MIME 类型和编解码器
          videoBitsPerSecond: video_bits_per_second, // 视频比特率
          width: width,
          height: height,
          frameRate: standard_frame_rate,
        });
        mediaRecorder.ondataavailable = (event) => {
          // event.data 是一个 Blob，包含了录制的视频片段
          accumulated_size_blob += event.data.size;
          // 获取视频帧数
          console.log(
            `Emitted a video BLOB, BPS: ${
              (accumulated_size_blob / blob_period) * 1000
            }`
          );
          if (event.data && event.data.size > 0) {
            // 将Blob转换为Frames

            const reader = new FileReader();
            reader.readAsArrayBuffer(event.data);
            reader.onload = () => {
              const arrayBuffer = reader.result;
              const uint8Array = new Uint8Array(arrayBuffer);
              const frames = [];
              let frame_size = 0;
              for (let i = 0; i < uint8Array.length; i++) {
                frame_size += uint8Array[i];
                if (frame_size === 0) {
                  frames.push(i);
                  frame_size = 0;
                }
              }

              // 发送视频帧数
              send_ws_msg(`video_info{"frames":${frames.length}}`);
            };
          }
        };
        mediaRecorder.start(blob_period); // 开始录制 , 2000ms 为一个blob
        // initFrameCapture(stream);

        localVideo.srcObject = stream; // 显示本地画面
      })
      .catch((err) => {
        console.error("Error accessing camera: ", err);
      });
  }
}

// User-defined Configuration
const standard_video_path = "standard_video_1600k_540_15fps_6s.mp4";
const standard_frame_rate = 15; // 帧率
const frame_period = 1000 / standard_frame_rate; // 毫秒
const width = 540; // 观察画面尺寸（显卡性能限制，不掉帧即可）
const height = 405;
const total_frames = 0;
const total_time = 0;
const video_bits_per_second = 6400000; // 视频比特率，800kbps
const blob_period = 2000; // 发送视频帧的间隔，单位毫秒

let enabled_1 = false;
let paused = false;
let socket = null;
let mediaRecorder = null;
let mediaStream = null;
let receiver_id = null;
let imageCapture = null;
let video = null;
let source = null;

function connect_ws() {
  socket = new WebSocket(`ws://${location.host}/ws`);

  socket.onmessage = function (event) {
    msg = event.data;
    // 接收到stop后，再运行一次stop函数
    if (msg == "stop") {
      enabled_1 = false;
      paused = false;
      document.getElementById("stop").click();
    }
    if (msg.slice(0, 5) == "video") {
      data = JSON.parse(msg.slice(5));
      // 显示远程画面
      remoteVideo.src = URL.createObjectURL(data);
    }
  };
}
function send_ws_msg(msg) {
  if (socket && socket.readyState == 1) {
    socket.send(msg);
  } else {
    connect_ws();
    setTimeout(function () {
      send_ws_msg(msg);
    }, 1000);
  }
}
window.onload = function () {
  document.getElementById("start").addEventListener("click", async function () {
    if (enabled_1) {
      document.getElementById("pause").click();
      return;
    }
    paused = false;
    enabled_1 = true;

    source = new EventSource("/message");
    source.onmessage = function (event) {
      const data = event.data.split("#");
      const messageObject = {};

      data.forEach((line) => {
        const [key, value] = line.split("$");
        if (key && value) {
          messageObject[key] = value;
        }
      });
      // handler
      if (messageObject.name === "pose") {
        const pose = JSON.parse(messageObject.pose);
        console.log(pose); // 我也不知道结构
        const keypoints = pose.keypoints.map((keypoint) => ({
          position: {
            x: keypoint.position.x,
            y: keypoint.position.y,
          },
          score: keypoint.score,
          part: keypoint.part,
        }));
        let ctx = remoteVideo.getContext("2d");
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showBoundingBox) {
          drawBoundingBox(keypoints, ctx);
        }
      } else if (messageObject.name === "progress") {
        // 进度条
        console.log(messageObject.progress);
        document.getElementById("progress").value = messageObject.progress;
      }
    };
    // initCamera();// 旧版，在后端处理视频帧
    socket = new WebSocket(`ws://${location.host}/ws`);
    send_ws_msg("start");

    setupFPS();

    try {
      video = await loadVideo();
    } catch (e) {
      let info = document.getElementById("info");
      info.textContent =
        "this browser does not support video capture," +
        "or this device does not have a camera";
      info.style.display = "block";
      throw e;
    }

    detectPoseInRealTime(video, false);
  });

  document.getElementById("stop").addEventListener("click", function () {
    enabled_1 = false;
    const remoteVideo = document.getElementById("remoteVideo");
    const localVideo = document.getElementById("localVideo");
    closeFPS();
    // stop the message source
    if (source) {
      document.getElementById("progress").value = 100; // 进度条
      source.close();
      source = null;
    }
    // close the socket
    if (socket && socket.connected) {
      send_ws_msg("stop");
      socket.disconnect();
    }
    if (remoteVideo.src) {
      // 是个链接，需要清除
      remoteVideo.setAttribute("src", "");
      remoteVideo.style.opacity = 0;
      localVideo.setAttribute("src", "");
      localVideo.style.opacity = 0;
    }
    // close the camera
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    // stop the recorder
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    if (receiver_id) {
      clearInterval(receiver_id);
      receiver_id = null;
    }
    if (imageCapture) {
      imageCapture = null;
    }
  });
};
document.getElementById("pause").addEventListener("click", function () {
  paused = !paused;
  send_ws_msg("pause");
});

const videoWidth = width;
const videoHeight = height;
const stats = new Stats(); // 性能统计(FPS)

// 打开摄像头
async function setupCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "Browser API navigator.mediaDevices.getUserMedia not available"
    );
  }

  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined : videoHeight,
    },
  });
  video.srcObject = mediaStream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

const testLocal = false;
async function loadVideo() {
  let _video = document.getElementById("localVideo");
  if (testLocal) {
    _video.src = "/static/std64.mp4"; // 测试集：用本地文件代替用户摄像头
  } else {
    _video = await setupCamera(_video);
  }
  const video = _video;
  video.style.opacity = 1;
  video.width = videoWidth;
  video.height = videoHeight;
  video.play();
  const remoteVideo = document.getElementById("remoteVideo");
  remoteVideo.src = "/static/std64.mp4";
  remoteVideo.style.opacity = 1;
  remoteVideo.width = videoWidth;
  remoteVideo.height = videoHeight;
  remoteVideo.play();
  return video;
}

const guiState = {
  algorithm: "single-pose",
  input: {
    architecture: "ResNet50",
    outputStride: 32,
    inputResolution: 200,
    multiplier: 1,
    quantBytes: 2,
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    // minPartConfidence: 0.5, // PosNet
    minPartConfidence: 0.3, // MoveNet
  },
  multiPoseDetection: {
    maxPoseDetections: 5,
    minPoseConfidence: 0.15,
    minPartConfidence: 0.1,
    nmsRadius: 30.0,
  },
  output: {
    showVideo: true,
    showSkeleton: true,
    showPoints: true,
    showBoundingBox: false,
  },
  net: null,
};

function setupGui(cameras, net) {
  guiState.net = net;
}
function setupFPS() {
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.querySelector(".fpsbox").appendChild(stats.domElement);
}
function closeFPS() {
  stats.domElement.remove();
}

let round = 0;
let waiting = 0;

// 姿态计算
function detectPoseInRealTime(video, recording) {
  if (guiState.net == null) {
    if (waiting == 0) {
      waiting = 1;
      showModal("模型正在加载，请稍后...", "提示");
    }
    setTimeout(() => {
      detectPoseInRealTime(video, recording);
    }, 1000);
    return;
  }
  waiting = 0;
  hideAllModals();
  const canvas = document.getElementById("canvas");
  const passiveCanvas = document.getElementById("passiveCanvas");
  const skeletonCanvas = document.getElementById("skeletonCanvas");
  const skeletonCtx = skeletonCanvas.getContext("2d");

  const flipPoseHorizontal = true;

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  passiveCanvas.width = videoWidth;
  passiveCanvas.height = videoHeight;
  skeletonCanvas.width = videoWidth;
  skeletonCanvas.height = videoHeight;
  round = 0;
  // 初始化Action和ActionRecorder
  let action = new Action(canvas, passiveCanvas, skeletonCanvas);
  if (!recording) action.pushData(testData);

  let actionRecorder = new ActionRecorder(skeletonCanvas);
  const posesQueueLength = 5; // 队列长度
  let posesQueuelen = 0;
  const posesQueue = []; // 储存最近len个pose，进行平滑抖动
  const singleMinPoseConfidence = guiState.singlePoseDetection.minPoseConfidence;
  const multiMinPoseConfidence = guiState.multiPoseDetection.minPoseConfidence;
  const singleMinPartConfidence =
    guiState.singlePoseDetection.minPartConfidence * posesQueueLength;
  const multiMinPartConfidence =
    guiState.multiPoseDetection.minPartConfidence * posesQueueLength;
  const keypointsLength = 17; // 关键点数量

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
    if (flipPoseHorizontal) { // 手动水平翻转(MoveNet没有内置这个功能)
      poses.forEach((pose) => {
        pose.keypoints.forEach((keypoint) => {
          keypoint.x = videoWidth - keypoint.x * 0.75; // 至于为何要乘0.75(画框和原视频比例)，暂时不清楚
          keypoint.y = keypoint.y * 0.75;
        });
      });
    }
    if (poses[0].score >= singleMinPoseConfidence)
      poseProcessingFrame(
        singlePoseDetectionFrame,
        poses[0],
        singleMinPartConfidence
      );
    else requestAnimationFrame(singlePoseDetectionFrame);
  }

  async function multiPoseDetectionFrame() { // 该函数未测试
    stats.end();
    stats.begin();
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(multiPoseDetectionFrame);
      return;
    }
    const poses = await guiState.net.estimatePoses(video, {
      flipHorizontal: flipPoseHorizontal,
      decodingMethod: "multi-person",
      maxDetections: guiState.multiPoseDetection.maxPoseDetections,
      scoreThreshold: multiMinPartConfidence,
      nmsRadius: guiState.multiPoseDetection.nmsRadius,
    });

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
    // if (round == 1)debugger;
    // 平滑抖动模块
    // 记录动作，并计算前缀和
    // Pfs = Prefix Sum
    const prevWeightedKeypointsPfs =
      posesQueuelen > 0
        ? posesQueue[posesQueuelen - 1]
        : undefined; // 前一帧
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
          x: position.x * score + prevWeightedKeypointsPfs[i].x,
          y: position.y * score + prevWeightedKeypointsPfs[i].y,
          score: score + prevWeightedKeypointsPfs[i].score,
        });
      } catch (e) { // 第一次没有前缀和
        weightedKeypointsPfs.push({
          x: position.x * score,
          y: position.y * score,
          score: score,
        });
      }

    }
    posesQueue.push(weightedKeypointsPfs);
    if (posesQueuelen == posesQueueLength) posesQueue.shift(); else posesQueuelen++;

    round++;
    if (round == 1) {
      action.startDrawing(pose, Date.now());
      // 已经完成首次渲染，开始加载标准视频
      // remoteVideo.src = "/static/std-copy.mp4";
      // remoteVideo.style.opacity = 1;
      // remoteVideo.play();
    } else {
      // 产生平滑后的动作位置
      const B = weightedKeypointsPfs;
      const A = posesQueue[0];
      const weightedKeypoints = [];
      for (let i = 0; i < keypointsLength; i++) {
        const score = B[i].score - A[i].score;
        if (score < minPartConfidence) weightedKeypoints.push({position: {x: null, y: null}});
        else weightedKeypoints.push({
          position: {
            x: (B[i].x - A[i].x) / score,
            y: (B[i].y - A[i].y) / score,
          }
        });
      }
      
      // tracker: 跟踪连续动作
      if (recording) { 
        action.draw({keypoints: weightedKeypoints}, Date.now());
      } else {
        const actionScore = action.passiveDraw({keypoints: weightedKeypoints}, Date.now());
        if (actionScore !== 0) {
          document.getElementById(
            "score"
          ).textContent = `得分：${actionScore.toFixed(2)}`;
        }
      }

      // 如果视频结束，则停止录制
      if (video.ended) {
        action.endDrawing(Date.now());
        return;
      }
    }
    requestAnimationFrame(handle); // continue looping
  }

  switch (guiState.algorithm) {
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

// 加载posenet模型
export async function bindPage() {
  toggleLoadingUI(true);
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
  const detectorConfig = {modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER};
  const net = await poseDetection.createDetector(model, detectorConfig);
  toggleLoadingUI(false); // 关闭模型加载中的提示
  setupGui([], net); // 载入模型
}
// posenet模型需要联网加载，所以预先异步加载
bindPage();

navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
// kick off the demo
