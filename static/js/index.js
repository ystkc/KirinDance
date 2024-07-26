// Configuration
standard_video_path = "standard_video_1600k_540_15fps_6s.mp4"
standard_frame_rate = 15 // 帧率
frame_period = 1000 / standard_frame_rate // 毫秒
width = 540 // 观察画面尺寸（显卡性能限制，不掉帧即可）
height = 405
assess_width = 60 // 姿态计算画面尺寸（过高浪费性能，过低丢失精度）
assess_height = 45
total_frames = 0
total_time = 0
video_bits_per_second = 6400000 // 视频比特率，800kbps
blob_period = 2000 // 发送视频帧的间隔，单位毫秒

enabled = false;
socket = null;
mediaRecorder = null;
mediaStream = null;
receiver_id = null;
imageCapture = null;

localVideo = null;
remoteVideo = null;

accumulated_size_frame = 0;
accumulated_size_blob = 0;

window.onload = function(){
    localVideo = document.getElementById('localVideo');
    remoteVideo = document.getElementById('remoteVideo');
}
// function receive_video_frame() {// 旧版，用imageCapture捕获画面，转为blob，发送给服务器
//     imageCapture.grabFrame()  
//     .then(imageBitmap => {  
//         const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);  
//         const ctx = canvas.getContext('2d');  
//         ctx.drawImage(imageBitmap, 0, 0);  
//         canvas.convertToBlob({ type: 'image/jpeg' })  
//             .then(blob => {  
//                 accumulated_size_frame += blob.size;
//                 console.log('Emitted a video FRAME, BPS:', accumulated_size_frame / blob_period * 1000);
//                 socket.emit('video_frame', blob);  
//             })  
//             .catch(error => console.error('Convert to blob failed:', error));
//     });
// }
// function initFrameCapture(stream){
    // 旧版，用imageCapture捕获画面，转为blob，发送给服务器，因为压缩率低
    // imageCapture = new ImageCapture(stream.getVideoTracks()[0]);
    // receiver_id = setInterval(receive_video_frame, blob_period); // 定时发送视频帧
// }

function initCamera(){
    if (socket == null || !socket.connected) {
        socket = io.connect(`http://${window.location.hostname}:${window.location.port}`);
        socket.emit('start');
        socket.on('video', data => {;// 接收视频Blob数据
            console.log(`Received a video blob, size: ${data.size},Frames: ${data.frames}, `)
            if (data && data.size > 0) {  
                // 显示远程画面
                remoteVideo.src = URL.createObjectURL(data);
            }
        });
    }
    // check if the camera is available
    if (!localVideo.srcObject || !localVideo.srcObject.active) {
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
            mediaStream = stream;
            mediaRecorder = new MediaRecorder(stream, {  
                mimeType: 'video/webm; codecs=vp9', // 可以根据需要调整 MIME 类型和编解码器  
                videoBitsPerSecond: video_bits_per_second, // 视频比特率  
                width: width,
                height: height,
                frameRate: standard_frame_rate 
            });
            mediaRecorder.ondataavailable = event => {  
                // event.data 是一个 Blob，包含了录制的视频片段
                accumulated_size_blob += event.data.size;
                // 获取视频帧数
                console.log(`Emitted a video BLOB, BPS: ${accumulated_size_blob / blob_period * 1000}`)
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
                        socket.emit('video_info', { frames: frames.length });
                    }
                }  
            };  
            mediaRecorder.start(blob_period); // 开始录制 , 2000ms 为一个blob
            // initFrameCapture(stream);

            localVideo.srcObject = stream; // 显示本地画面
        })
        .catch(err => {
            console.error('Error accessing camera: ', err);
        });
    }
}



function start() {
    enabled = true;
    initCamera();
}

function stop() {
    enabled = false;
    // close the socket
    if (socket && socket.connected) {
        socket.emit('stop')
        socket.disconnect();
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
}