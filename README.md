一个基于 Cloudflare Workers 的验证码识别 API，它通过调用 Gemini 模型来处理图片并返回结果，结构清晰、逻辑完整。现在如果你想 **在其他自动化脚本（如 Python、Node.js 等）中调用这个验证码识别服务**，可以遵循以下流程：

---

## ✅ 使用流程概览

1. **提交图片（base64 编码）到 `/submit` 接口**
2. **获取返回的 `taskId`**
3. **轮询 `/result?taskId=xxx&apiKey=xxx` 获取识别结果**

---

## 🧩 一、接口调用说明

### 1. `POST /submit`

* **功能**：提交验证码图片（Base64 编码），开始识别任务
* **请求头**：

  ```http
  Authorization: Bearer <你的 AUTH_TOKEN>
  Content-Type: application/json
  ```
* **请求体**（JSON）：

  ```json
  {
    "image": "<base64编码后的PNG图像>"
  }
  ```
* **响应体**：

  ```json
  {
    "taskId": "xxxxx-xxxx-xxxx-xxxx"
  }
  ```

---

### 2. `GET /result?taskId=xxx&apiKey=xxx`

* **功能**：获取识别结果
* **参数说明**：

  * `taskId`：任务 ID
  * `apiKey`：验证身份用的 API 密钥
* **响应示例**：

  ```json
  {
    "status": "pending"
  }
  ```

  或：

  ```json
  {
    "status": "completed",
    "solution": "8"
  }
  ```

  或：

  ```json
  {
    "status": "error",
    "message": "识别失败原因"
  }
  ```

---

## 🧪 二、Python 脚本调用示例

```python
import requests
import time
import base64

# 配置
WORKER_URL = 'https://your-worker-url.com'
AUTH_TOKEN = 'your_auth_token'
API_KEY = 'your_api_key'

# 读取并编码图片
with open('captcha.png', 'rb') as f:
    img_base64 = base64.b64encode(f.read()).decode()

# 1. 提交识别任务
submit_resp = requests.post(
    f"{WORKER_URL}/submit",
    headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
    json={"image": img_base64}
)
submit_data = submit_resp.json()
task_id = submit_data['taskId']
print("Submitted Task ID:", task_id)

# 2. 轮询结果
while True:
    result_resp = requests.get(
        f"{WORKER_URL}/result",
        params={"taskId": task_id, "apiKey": API_KEY}
    )
    result_data = result_resp.json()
    if result_data['status'] == 'completed':
        print("识别结果:", result_data['solution'])
        break
    elif result_data['status'] == 'error':
        print("识别出错:", result_data['message'])
        break
    else:
        print("等待识别中...")
        time.sleep(2)
```

---

## ⚙️ 三、Node.js 示例（使用 `axios`）

```javascript
const axios = require('axios');
const fs = require('fs');

const WORKER_URL = 'https://your-worker-url.com';
const AUTH_TOKEN = 'your_auth_token';
const API_KEY = 'your_api_key';

// 读取图片并编码
const imageBase64 = fs.readFileSync('captcha.png', { encoding: 'base64' });

// 提交任务
axios.post(`${WORKER_URL}/submit`, {
  image: imageBase64
}, {
  headers: {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json'
  }
}).then(res => {
  const taskId = res.data.taskId;
  console.log("任务 ID:", taskId);

  // 轮询结果
  const interval = setInterval(() => {
    axios.get(`${WORKER_URL}/result`, {
      params: { taskId, apiKey: API_KEY }
    }).then(result => {
      const data = result.data;
      if (data.status === 'completed') {
        console.log("识别结果:", data.solution);
        clearInterval(interval);
      } else if (data.status === 'error') {
        console.error("识别错误:", data.message);
        clearInterval(interval);
      } else {
        console.log("等待识别...");
      }
    });
  }, 2000);
});
```

---

## 📌 注意事项

| 项目配置项            | 说明                              |
| ---------------- | ------------------------------- |
| `AUTH_TOKEN`     | 用于提交任务的身份验证（请求头）                |
| `API_KEY`        | 用于查询结果时的身份验证（URL参数）             |
| `GEMINI_API_KEY` | 存在于 Worker 环境变量中，用户不可见          |
| `RESULTS_KV`     | Cloudflare Workers KV 命名空间，缓存结果 |
| 图片格式             | 仅支持 `image/png`（可根据需要修改 MIME）   |

---

如需支持**上传图像文件**或**直接处理图片 URL**，可进一步拓展 `handleSubmit` 中的解析逻辑。

如需，我可以继续帮你生成一个用于测试的 Web 页面上传图片并调用这两个接口。是否需要？
