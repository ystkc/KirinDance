# KirinDance

迳口村麒麟舞的动作视觉识别和评分系统，为了发扬麒麟舞文化，促进学习者的兴趣。采用 OpenPose 和 PoseNet 进行多人实时姿态识别，可作为舞蹈和复杂动态动作识别和评分的系统。
@中山大学集成电路学院

### 使用方式

1. 将要学习的麒麟舞视频放在根目录 /static 文件夹下，命名为 std64_fixed.mp4
2. 安装ruby 3.3.3(可以通过命令`ruby -v`检查版本)，然后运行`gem install bundler -v 2.5.22`，然后在项目根目录运行`bundle install`
3. 运行launch.bat，会自动打开浏览器
4. 若脚本运行出现错误，可以在项目根目录下使用终端运行 **`bundle exec jekyll serve --disable-disk-cache --incremental --port 8860`** 初次运行大约需要5分钟，等待出现终端出现消息：`Server running... press ctrl-c to stop.` 后在本电脑使用浏览器访问 **`localhost:8860/KirinDance`**

---

> 下面的内容适合开发者食用

---

### 核心模块 ActionCamera 封装接口文档

**作用** ：给定用户的摄像头和标准图像流，对两者进行的动作进行实时比对和评分，并将图像和骨架渲染到给定的画布上。

**使用方法** ：先实例化 ActionCamera 类，指定要绑定到的图像流元素和画布元素，然后调用 startPlaying 方法，传入标准视频 url 和用户视频 url（可指定为url或摄像头），加载完成后会自动开始播放并评分。调用 startPlaying 后可以定时调用 getStatus 方法获取当前状态和分数。调用 stopPlaying 方法停止播放。

为了改善体验，可以先调用 startCaching 方法缓存标准视频姿态数据，然后将缓存载入程序中传入 startPlaying 方法播放用户视频，这样可以减少计算，改善用户体验。

**API文档**：

> constructor(remoteVideo, localCamera, remoteCanvas, localCanvas, config=null)

实例化 ActionCamera 类

```
remoteVideo: 显示标准视频的video元素
localCamera: 显示用户摄像头，或者待评分的视频的video元素
remoteCanvas: 重叠于remoteVideo之上的canvas元素，用于绘制标准视频的姿态骨架
localCanvas: 重叠于localCamera之上的canvas元素，同上
config: 加载配置，对象
```

配置为 null 时的默认配置：

```
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
```

⚠️constructor 是同步函数，可以通过 config.input.loadedCallback 获取加载完成通知

> getConfig()

获取配置对象的深拷贝

> checkConfig(config)

检查配置是否合法，在 setConfig 时会自动调用。检测到不合法会抛出错误

> setConfig(config)

载入配置，加载时会拷贝 config，后续修改不会被同步

> getStatus()

获取当前状态和分数，格式如下：

```
const result = {
  score: number, // 最新1s内分数
  tip: enum, // 提示用户的站立位置（远离、靠近、调整摄像头）
  paused: bool, // 是否暂停播放（姿态解算不暂停，可用于调整模仿）
  currentTime: number, // 当前视频播放位置
  duration: number, // 当前视频总时长
  finalScore: number || null, // 是否有最终分数返回（每次播放只会返回一次）
  finalRemoteCache: object || null, // 是否有标准视频缓存数据返回（每次播放只会返回一次）
  waiting: bool, // 模型是否还在加载
};
```

其中 tip 的 enum 含义如下：

```
const TIP_TEXT = {
   0: "", // 清除提示
   1: "🔥请远离摄像头，确保全身入镜🔥",
   2: "❄️请靠近摄像头❄️",
   3: "🌟请全身入镜🌟",
   4: "姿势差太多啦",
};
```

> async startPlaying( standardSrc, customSrc = null, standardCache = null, customCache = null )

开始播放并进行姿态解算或从缓存中加载姿态数据，并评分

```
standardSrc: 标准视频url
customSrc: 用户视频url，null时采用本地摄像头
standardCache: 标准视频缓存数据，null时不使用缓存
customCache: 用户视频缓存数据，null时不使用缓存
```

函数中会自动加载视频，并自动开始播放、评分。成功时返回 true，失败时返回 false

> async startCaching(standardSrc)

功能类似 startPlaying，但是不加载用户视频流，只计算标准视频的姿态数据并缓存，结束后输出到控制台

```
standardSrc: 标准视频url
```

自动加载视频并计算缓存，结束时返回缓存数据。成功时返回 true，失败时返回 false

> async stopPlaying()

停止播放，释放资源。如果是缓存模式，已计算的缓存会被丢弃

---

> 后面的内容纯烤谷，可以不用看了

---

### 评分技术演进

#### 第一版算法（傅里叶变换方案）

**原理**：

- 通过傅里叶变换将关节坐标（X/Y 轴）转换到频域
- 消除时间延迟干扰，对比标准动作与用户动作的频域幅度相似性
- 评分依据：正确频率幅度占比与错误频率衰减程度

**局限性**：

1. 低频测量导致精度丢失
2. 摄像头抖动（10px 内波动）产生杂值
3. 实时反馈缺失影响用户体验
4. FFT 步长限制导致系统延迟

**解决方案**：

- 采用低通滤波缓解抖动问题
- 放弃持续优化，转向第二版方案

---

#### 第二版算法（关节角度计算方案）

**原理**：

1. 使用 MediaPipe 提取 33 个姿态关键点
2. 计算特定关节角度（手臂/腿部/身体倾斜）
3. 通过分段函数映射角度偏差与得分：
   - ≤10°：近满分（100-0.03x²）
   - 10-70°：平方衰减（94.23-0.02(x-8)²）
   - > 70°：指数衰减（17.35e^{-(x-70)/20}）

**代码亮点**：

- 动态计算肩/髋部中心点作为参考系
- 异常处理机制保障流程稳定性

**局限性**：

- 评分波动明显（同一帧多次评分差异大）
- 姿态差异容错过高（如坐姿与站姿可能得高分）

**优化方向**：

- 历史数据缓存平滑波动
- 引入时间尺度分析解决动态延迟问题

---

#### 第三版算法（时空动态分析方案）

**核心创新**：

1. **时间单位划分**：消除帧率差异影响
2. **关节动态判定**：
   - 基于平滑后位移阈值判定动作区间
   - 方向变化阈值（30°-45°）切分连续性动作
3. **冲突解决机制**：
   - 优先保留最低移动关节（如手腕动作覆盖肩部抖动）
   - 速度加权选择主运动关节

**实时监控模块**：

- 绘制动作轨迹历史
- 动态提示"动作变化/方向变化"
- 不连续性超过阈值则重置评分单元

**当前状态**：

- 代码已实现全部动态评分功能
- 时间轴错位严重
- 精度不能达到预期，标准对拍也不能达到高分，分数评判无法解释
- 性能消耗较大，优化后将同色渲染合批，但大量渲染节点颜色不同难以合批

#### 第四版算法（静态关节距离幂方案）

**当前状态**

- 代码已实现全部评分功能，并添加了大量注释
- 算法受到用户和摄像头距离的影响，实现了摄像头距离测算函数并提示用户这个改善方案
- 通过调整参数可以达到预期评分目标，可以实现难度的调节
- 项目完成

---

# 更新记录

## 第一、二期

- 导入了模型图、人体姿态识别和基于傅里叶变换的初代视频对照评分系统
- 增加示范视频姿态数据的缓存(pickle)降低卡顿

## 第三期

- 环境迁移为 flask，采用服务器模式，以期提升渲染性能，使用 socket.io 通信以备后期扩展
- 修复录制的视频水平翻转问题
- 适当降低视频码率和尺寸，提高性能
- 放弃 OpenPose 的 WebAssembly 模式，转为使用 PosNet（ResNet50）

## 第四期

- 迁移到 fastapi，采用异步处理，提升响应速度。改用 websocket 通信

## 第五期

- 部署了静态站点，舍弃后端代码，转为采用 MoveNet，进一步提升性能。改版了算法并进行了 ActionCamera 类的封装，具备复用条件。
