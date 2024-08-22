/**
 * @license
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
 */
// import * as posenet from '@tensorflow-models/posenet';
// import dat from 'dat.gui';
// import Stats from 'stats.js';

// import {drawBoundingBox, drawKeypoints, drawSkeleton, isMobile, toggleLoadingUI, tryResNetButtonName, tryResNetButtonText, updateTryResNetButtonDatGuiCss} from './demo_util';


// User-defined Configuration
const standard_video_path = "standard_video_1600k_540_15fps_6s.mp4"
const standard_frame_rate = 15 // 帧率
const frame_period = 1000 / standard_frame_rate // 毫秒
const width = 540 // 观察画面尺寸（显卡性能限制，不掉帧即可）
const height = 405
const assess_width = 60 // 姿态计算画面尺寸（过高浪费性能，过低丢失精度）
const assess_height = 45
const total_frames = 0
const total_time = 0
const video_bits_per_second = 6400000 // 视频比特率，800kbps
const blob_period = 2000 // 发送视频帧的间隔，单位毫秒
 
let enabled_1 = false;
let socket = null;
let mediaRecorder = null;
let mediaStream = null;
let receiver_id = null;
let imageCapture = null;
let video = null;
let source = null;
 
let localVideo = null;
let remoteVideo = null;
let mask_left = null;

// let accumulated_size_frame = 0;
// let accumulated_size_blob = 0;

window.onload = function(){
  remoteVideo = document.getElementById('remoteVideo');
  localVideo = document.getElementById('output');
  mask_left = document.getElementById('output_mask');
  // 调整大小

  localVideo.width = width;
  localVideo.height = height;
  remoteVideo.width = width;
  remoteVideo.height = height;
  mask_left.width = width;
  mask_left.height = height;
    
  document.getElementById('start').addEventListener('click', async function () {
    if (enabled_1) {
      document.getElementById('pause').click();
      return;
    }
    enabled_1 = true;

    source = new EventSource('/message');
    source.onmessage = function (event) {
      const data = event.data.split('#');
      const messageObject = {};

      data.forEach(line => {
        const [key, value] = line.split('$');
        if (key && value) {
          messageObject[key] = value;
        }
      });
      // handler
      if (messageObject.type === 'pose') {
        const pose = JSON.parse(messageObject.pose);
        console.log(pose); // 我也不知道结构
        const keypoints = pose.keypoints.map(keypoint => ({
          position: {
            x: keypoint.position.x,
            y: keypoint.position.y
          },
          score: keypoint.score,
          part: keypoint.part
        }));
        let ctx = remoteVideo.getContext('2d');
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showBoundingBox) {
          drawBoundingBox(keypoints, ctx);
        }

      }
      else if (messageObject.type === 'progress') {
        // 进度条
        console.log(messageObject.progress);
        document.getElementById('progress').value = messageObject.progress;
      }
    };
    // initCamera();// 旧版，在后端处理视频帧
    socket = io.connect(`http://${window.location.hostname}:${window.location.port}`);
    socket.emit('start');
    // 接收到stop后，再运行一次stop函数
    socket.on('stop', function () {
      enabled_1 = false;
      document.getElementById('stop').click();
    });


    setupFPS();
    
    try {
      video = await loadVideo();
    } catch (e) {
      let info = document.getElementById('info');
      info.textContent = 'this browser does not support video capture,' +
          'or this device does not have a camera';
      info.style.display = 'block';
      throw e;
    }
    
    detectPoseInRealTime(video);
  });

  document.getElementById('stop').addEventListener('click', function () { 
    enabled_1 = false;
    
    closeFPS();
    // stop the message source
    if (source) {
      source.close();
      source = null;
    }
    // close the socket
    if (socket && socket.connected) {
        socket.emit('stop');
        socket.disconnect();
    }
    if (remoteVideo.src) {
      // 是个链接，需要清除
      remoteVideo.setAttribute('src', '');
      remoteVideo.style.opacity = 0;
    }
    // close the camera
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
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
    if (imageCapture){
        imageCapture = null;
    }
  });

}
document.getElementById('pause').addEventListener('click', function () { 
  socket.emit('pause');
});


const videoWidth = width;
const videoHeight = height;
const stats = new Stats();

/**
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
        'Browser API navigator.mediaDevices.getUserMedia not available');
  }

  video = document.getElementById('video');
  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
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

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}


const guiState = {
  algorithm: 'multi-pose',
  input: {
    architecture: 'ResNet50',
    outputStride: 32,
    inputResolution: 200,
    multiplier: 1,
    quantBytes: 2
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    minPartConfidence: 0.5,
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

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras, net) {
  guiState.net = net;
  

//   if (cameras.length > 0) {
//     guiState.camera = cameras[0].deviceId;
//   }

//   const gui = new dat.GUI({width: 300});

//   let architectureController = null;
//   guiState[tryResNetButtonName] = function() {
//     architectureController.setValue('ResNet50')
//   };
//   gui.add(guiState, tryResNetButtonName).name(tryResNetButtonText);
//   updateTryResNetButtonDatGuiCss();

//   // The single-pose algorithm is faster and simpler but requires only one
//   // person to be in the frame or results will be innaccurate. Multi-pose works
//   // for more than 1 person
//   const algorithmController =
//       gui.add(guiState, 'algorithm', ['single-pose', 'multi-pose']);

//   // The input parameters have the most effect on accuracy and speed of the
//   // network
//   let input = gui.addFolder('Input');
//   // Architecture: there are a few PoseNet models varying in size and
//   // accuracy. 1.01 is the largest, but will be the slowest. 0.50 is the
//   // fastest, but least accurate.
//   architectureController =
//       input.add(guiState.input, 'architecture', ['MobileNetV1', 'ResNet50']);
//   guiState.architecture = guiState.input.architecture;
//   // Input resolution:  Internally, this parameter affects the height and width
//   // of the layers in the neural network. The higher the value of the input
//   // resolution the better the accuracy but slower the speed.
//   let inputResolutionController = null;
//   function updateGuiInputResolution(
//       inputResolution,
//       inputResolutionArray,
//   ) {
//     if (inputResolutionController) {
//       inputResolutionController.remove();
//     }
//     guiState.inputResolution = inputResolution;
//     guiState.input.inputResolution = inputResolution;
//     inputResolutionController =
//         input.add(guiState.input, 'inputResolution', inputResolutionArray);
//     inputResolutionController.onChange(function(inputResolution) {
//       guiState.changeToInputResolution = inputResolution;
//     });
//   }

//   // Output stride:  Internally, this parameter affects the height and width of
//   // the layers in the neural network. The lower the value of the output stride
//   // the higher the accuracy but slower the speed, the higher the value the
//   // faster the speed but lower the accuracy.
//   let outputStrideController = null;
//   function updateGuiOutputStride(outputStride, outputStrideArray) {
//     if (outputStrideController) {
//       outputStrideController.remove();
//     }
//     guiState.outputStride = outputStride;
//     guiState.input.outputStride = outputStride;
//     outputStrideController =
//         input.add(guiState.input, 'outputStride', outputStrideArray);
//     outputStrideController.onChange(function(outputStride) {
//       guiState.changeToOutputStride = outputStride;
//     });
//   }

//   // Multiplier: this parameter affects the number of feature map channels in
//   // the MobileNet. The higher the value, the higher the accuracy but slower the
//   // speed, the lower the value the faster the speed but lower the accuracy.
//   let multiplierController = null;
//   function updateGuiMultiplier(multiplier, multiplierArray) {
//     if (multiplierController) {
//       multiplierController.remove();
//     }
//     guiState.multiplier = multiplier;
//     guiState.input.multiplier = multiplier;
//     multiplierController =
//         input.add(guiState.input, 'multiplier', multiplierArray);
//     multiplierController.onChange(function(multiplier) {
//       guiState.changeToMultiplier = multiplier;
//     });
//   }

//   // QuantBytes: this parameter affects weight quantization in the ResNet50
//   // model. The available options are 1 byte, 2 bytes, and 4 bytes. The higher
//   // the value, the larger the model size and thus the longer the loading time,
//   // the lower the value, the shorter the loading time but lower the accuracy.
//   let quantBytesController = null;
//   function updateGuiQuantBytes(quantBytes, quantBytesArray) {
//     if (quantBytesController) {
//       quantBytesController.remove();
//     }
//     guiState.quantBytes = +quantBytes;
//     guiState.input.quantBytes = +quantBytes;
//     quantBytesController =
//         input.add(guiState.input, 'quantBytes', quantBytesArray);
//     quantBytesController.onChange(function(quantBytes) {
//       guiState.changeToQuantBytes = +quantBytes;
//     });
//   }

//   // function updateGui() {
//   //   if (guiState.input.architecture === 'MobileNetV1') {
//   //     updateGuiInputResolution(
//   //         defaultMobileNetInputResolution,
//   //         [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800]);
//   //     updateGuiOutputStride(defaultMobileNetStride, [8, 16]);
//   //     updateGuiMultiplier(defaultMobileNetMultiplier, [0.50, 0.75, 1.0]);
//   //   } else {  // guiState.input.architecture === "ResNet50"
//   //     updateGuiInputResolution(
//   //         defaultResNetInputResolution,
//   //         [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800]);
//   //     updateGuiOutputStride(defaultResNetStride, [32, 16]);
//   //     updateGuiMultiplier(defaultResNetMultiplier, [1.0]);
//   //   }
//   //   updateGuiQuantBytes(defaultQuantBytes, [1, 2, 4]);
//   // }

//   // updateGui();
//   input.open();
//   // Pose confidence: the overall confidence in the estimation of a person's
//   // pose (i.e. a person detected in a frame)
//   // Min part confidence: the confidence that a particular estimated keypoint
//   // position is accurate (i.e. the elbow's position)
//   let single = gui.addFolder('Single Pose Detection');
//   single.add(guiState.singlePoseDetection, 'minPoseConfidence', 0.0, 1.0);
//   single.add(guiState.singlePoseDetection, 'minPartConfidence', 0.0, 1.0);

//   let multi = gui.addFolder('Multi Pose Detection');
//   multi.add(guiState.multiPoseDetection, 'maxPoseDetections')
//       .min(1)
//       .max(20)
//       .step(1);
//   multi.add(guiState.multiPoseDetection, 'minPoseConfidence', 0.0, 1.0);
//   multi.add(guiState.multiPoseDetection, 'minPartConfidence', 0.0, 1.0);
//   // nms Radius: controls the minimum distance between poses that are returned
//   // defaults to 20, which is probably fine for most use cases
//   multi.add(guiState.multiPoseDetection, 'nmsRadius').min(0.0).max(40.0);
//   multi.open();

//   let output = gui.addFolder('Output');
//   output.add(guiState.output, 'showVideo');
//   output.add(guiState.output, 'showSkeleton');
//   output.add(guiState.output, 'showPoints');
//   output.add(guiState.output, 'showBoundingBox');
//   output.open();


//   architectureController.onChange(function(architecture) {
//     // if architecture is ResNet50, then show ResNet50 options
//     updateGui();
//     guiState.changeToArchitecture = architecture;
//   });

//   algorithmController.onChange(function(value) {
//     switch (guiState.algorithm) {
//       case 'single-pose':
//         multi.close();
//         single.open();
//         break;
//       case 'multi-pose':
//         single.close();
//         multi.open();
//         break;
//     }
//   });
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
function setupFPS() {
  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.querySelector('.fpsbox').appendChild(stats.domElement);
}
function closeFPS(){
  stats.domElement.remove();
}

/**
 * Feeds an image to posenet to estimate poses - this is where the magic
 * happens. This function loops with a requestAnimationFrame method.
 */
let round = 0;
let waiting = 0;

function detectPoseInRealTime(video, net) {
  
  if (guiState.net == null){
    if (waiting == 0){
      waiting = 1;
      showModal("提示","模型正在加载，请稍后...");
    }
    setTimeout(() => {
      detectPoseInRealTime(video, net);
    }, 1000);
    return ;
  }
  waiting = 0;
  hideAllModals();
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');

  // since images are being fed from a webcam, we want to feed in the
  // original image and then just flip the keypoints' x coordinates. If instead
  // we flip the image, then correcting left-right keypoint pairs requires a
  // permutation on all the keypoints.
  const flipPoseHorizontal = true;

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  round = 0;
  initJointState();

  async function poseDetectionFrame() {
    

    let time_start = null;
    let time_current = null;
    let max_interruption = 3;
    let interrupion_count = 0;
    let prev_pose = null;
    
    
    

    // 下面这些是换模型用的，此处无需
    // if (guiState.changeToArchitecture) {
    //   // Important to purge variables and free up GPU memory
    //   guiState.net.dispose();
    //   toggleLoadingUI(true);
    //   guiState.net = await posenet.load({
    //     architecture: guiState.changeToArchitecture,
    //     outputStride: guiState.outputStride,
    //     inputResolution: guiState.inputResolution,
    //     multiplier: guiState.multiplier,
    //   });
    //   toggleLoadingUI(false);
    //   guiState.architecture = guiState.changeToArchitecture;
    //   guiState.changeToArchitecture = null;
    // }

    // if (guiState.changeToMultiplier) {
    //   guiState.net.dispose();
    //   toggleLoadingUI(true);
    //   guiState.net = await posenet.load({
    //     architecture: guiState.architecture,
    //     outputStride: guiState.outputStride,
    //     inputResolution: guiState.inputResolution,
    //     multiplier: +guiState.changeToMultiplier,
    //     quantBytes: guiState.quantBytes
    //   });
    //   toggleLoadingUI(false);
    //   guiState.multiplier = +guiState.changeToMultiplier;
    //   guiState.changeToMultiplier = null;
    // }

    // if (guiState.changeToOutputStride) {
    //   // Important to purge variables and free up GPU memory
    //   guiState.net.dispose();
    //   toggleLoadingUI(true);
    //   guiState.net = await posenet.load({
    //     architecture: guiState.architecture,
    //     outputStride: +guiState.changeToOutputStride,
    //     inputResolution: guiState.inputResolution,
    //     multiplier: guiState.multiplier,
    //     quantBytes: guiState.quantBytes
    //   });
    //   toggleLoadingUI(false);
    //   guiState.outputStride = +guiState.changeToOutputStride;
    //   guiState.changeToOutputStride = null;
    // }

    // if (guiState.changeToInputResolution) {
    //   // Important to purge variables and free up GPU memory
    //   guiState.net.dispose();
    //   toggleLoadingUI(true);
    //   guiState.net = await posenet.load({
    //     architecture: guiState.architecture,
    //     outputStride: guiState.outputStride,
    //     inputResolution: +guiState.changeToInputResolution,
    //     multiplier: guiState.multiplier,
    //     quantBytes: guiState.quantBytes
    //   });
    //   toggleLoadingUI(false);
    //   guiState.inputResolution = +guiState.changeToInputResolution;
    //   guiState.changeToInputResolution = null;
    // }

    // if (guiState.changeToQuantBytes) {
    //   // Important to purge variables and free up GPU memory
    //   guiState.net.dispose();
    //   toggleLoadingUI(true);
    //   guiState.net = await posenet.load({
    //     architecture: guiState.architecture,
    //     outputStride: guiState.outputStride,
    //     inputResolution: guiState.inputResolution,
    //     multiplier: guiState.multiplier,
    //     quantBytes: guiState.changeToQuantBytes
    //   });
    //   toggleLoadingUI(false);
    //   guiState.quantBytes = guiState.changeToQuantBytes;
    //   guiState.changeToQuantBytes = null;
    // }

    // Begin monitoring code for frames per second
    stats.begin();

    let poses = [];
    let minPoseConfidence;
    let minPartConfidence;
    switch (guiState.algorithm) {
      case 'single-pose':
        const pose = await guiState.net.estimatePoses(video, {
          flipHorizontal: flipPoseHorizontal,
          decodingMethod: 'single-person'
        });
        poses = poses.concat(pose);
        minPoseConfidence = +guiState.singlePoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.singlePoseDetection.minPartConfidence;
        break;
      case 'multi-pose':
        
        let all_poses = await guiState.net.estimatePoses(video, {
          flipHorizontal: flipPoseHorizontal,
          decodingMethod: 'multi-person',
          maxDetections: guiState.multiPoseDetection.maxPoseDetections,
          scoreThreshold: guiState.multiPoseDetection.minPartConfidence,
          nmsRadius: guiState.multiPoseDetection.nmsRadius
        });
        

        poses = poses.concat(all_poses);
        minPoseConfidence = +guiState.multiPoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.multiPoseDetection.minPartConfidence;
        break;
    }

    
    // 先发送第一个人的信息给后端
    if (poses.length > 0 && socket && socket.connected) {
      let pose = poses[0];
      socket.emit('pose', {
        score: pose.score,
        keypoints: pose.keypoints.map(keypoint => ({
          position: {
            x: keypoint.position.x,
            y: keypoint.position.y
          },
          score: keypoint.score,
          part: keypoint.part
        }))
      });
    }

    

    ctx.clearRect(0, 0, videoWidth, videoHeight);
    
    

    if (guiState.output.showVideo) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-videoWidth, 0);
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
      
      ctx.restore();
    }

    // For each pose (i.e. person) detected in an image, loop through the poses
    // and draw the resulting skeleton and keypoints if over certain confidence
    // scores
    // poses.forEach(({score, keypoints}) => {
    //   if (score >= minPoseConfidence) {
    //     if (guiState.output.showPoints) {
    //       drawKeypoints(keypoints, minPartConfidence, ctx);
    //     }
    //     if (guiState.output.showSkeleton) {
    //       drawSkeleton(keypoints, minPartConfidence, ctx);
    //     }
    //     if (guiState.output.showBoundingBox) {
    //       drawBoundingBox(keypoints, ctx);
    //     }
    //   }
    // });
    // 只要第一个pose
    if (poses.length > 0) {
      let score = poses[0].score;
      let keypoints = poses[0].keypoints;
      if (score >= minPoseConfidence) {
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showBoundingBox) {
          drawBoundingBox(keypoints, ctx);
        }
      }
    }
    // tracker: 跟踪连续动作
      updateJointState(poses[0], Date.now());

    // End monitoring code for frames per second
    stats.end();
    
    round++;
    if (round == 1){
      // 已经完成首次渲染，开始加载标准视频
      remoteVideo.src = `/video_feed?time=${Date.now()}`
      remoteVideo.style.opacity = 1;
      
    }
    
    if (!enabled_1) {
      // 清屏
      ctx.clearRect(0, 0, videoWidth, videoHeight);
      const ctx_left = mask_left.getContext('2d');
      ctx_left.clearRect(0, 0, videoWidth, videoHeight);
      // 此处无需其他清理，在按钮点击时清理
      return;
    }
    requestAnimationFrame(poseDetectionFrame); // continue looping
  }

  poseDetectionFrame();
}

/**
 * Kicks off the demo by loading the posenet model, finding and loading
 * available camera devices, and setting off the detectPoseInRealTime function.
 */
export async function bindPage() {
  toggleLoadingUI(true);
  const net = await posenet.load({
    architecture: guiState.input.architecture,
    outputStride: guiState.input.outputStride,
    inputResolution: guiState.input.inputResolution,
    multiplier: guiState.input.multiplier,
    quantBytes: guiState.input.quantBytes
  });
  toggleLoadingUI(false);
  // posenet模型需要联网加载，所以预先异步加载
  setupGui([], net);
  
  
}
bindPage();

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
// kick off the demo


