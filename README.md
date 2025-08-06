### 项目介绍、部署教程以及 API 调用指南。

-----

### **验证码识别服务 (Gemini on Cloudflare Workers) 综合文档**

这是一个功能强大且易于部署的**验证码识别服务**。它基于 Cloudflare Workers 的无服务器架构，并利用 Google Gemini Pro Vision 的多模态能力来分析和解析图片中的验证码。

#### **核心功能**

1.  **异步处理**: 用户提交验证码图片后，服务会立即返回一个任务ID (`taskId`)。AI识别过程在后台执行，不会阻塞客户端。
2.  **双重验证**: 通过 `AUTH_TOKEN` 和 `API_KEY` 对提交和查询接口进行保护，确保服务不会被滥用。
3.  **智能识别**: 后端的指令经过优化，可以识别两种常见的验证码类型：
      * **字母数字组合**：直接提取图片中的字符串。
      * **数学计算题**：识别图片中的数学表达式（如 `12+3`），计算出结果并返回最终数字。
4.  **结果缓存**: 识别结果会存储在 Cloudflare KV 中，并设置了5分钟的自动过期时间，有效管理资源。
5.  **可视化界面**: 项目自带一个简洁的前端页面，方便你进行手动测试、获取 API 调用说明，并验证部署是否成功。
6.  **成本效益**: 部署在 Cloudflare Workers 上，可以享受其慷慨的免费额度。对于低流量应用，几乎可以实现零成本运行。

-----

### **部署教程 (复制粘贴版)**

本教程将指导你通过 Cloudflare 的网页控制台，以最简单的“复制粘贴”方式完成部署。

#### **第 1 步：准备工作**

1.  **一个 Cloudflare 账户**: 如果没有，请前往 [Cloudflare 官网](https://www.google.com/search?q=https://dash.cloudflare.com/sign-up) 注册。
2.  **一个 Google AI Gemini API 密钥**:
      * 前往 [Google AI for Developers](https://ai.google.dev/)。
      * 点击 “Get API key in Google AI Studio”。
      * 创建一个新的 API 密钥并妥善保管。

#### **第 2 步：创建 Worker 并粘贴代码**

1.  登录 Cloudflare 控制台，在左侧菜单中选择 **Workers 和 Pages**。
2.  点击 **创建（Create）** 创建 Worker。
3.  为你的 Worker 指定一个唯一的名称（例如 `my-captcha-solver`），然后点击 **部署（Deploy）**。
4.  部署成功后，点击 **编辑代码（Edit code)** 进入代码编辑器。
5.  **清空编辑器**中所有的默认代码，然后将本文开头你提供的**完整脚本**粘贴进去。
6.  点击右上角的 **Save and deploy** 按钮保存代码。

#### **第 3 步：配置变量与绑定**

1.  返回到你的 Worker 管理页面（点击左上角的 Worker 名称）。
2.  选择 **Settings** -\> **Variables**。在此页面中，你需要完成 **KV 命名空间绑定** 和 **环境变量** 的配置。

##### **KV 命名空间绑定 (KV Namespace Bindings)**

向下滚动到此部分，点击 **Add binding**，并按下表配置：

| 绑定类型 (Binding Type) | 变量名称 (Variable Name) | KV 命名空间 (KV Namespace) | 说明 (Description) |
| :--- | :--- | :--- | :--- |
| KV 命名空间 | `RESULTS_KV` | *由你创建，例如 `CAPTCHA_RESULTS`* | 用于存储异步任务的状态和最终识别结果。**变量名必须为 `RESULTS_KV`**，以匹配代码逻辑。 |

##### **环境变量 (Environment Variables)**

向上滚动到此部分，点击 **Add variable**，并按下表添加四个变量：

| 变量名称 (Variable Name) | 值 (Value) | 类型 | 说明 (Description) |
| :--- | :--- | :--- | :--- |
| **`GEMINI_API_KEY`** | 从 Google AI Studio 获取的 API 密钥。 | 文本 | 用于访问 Google Gemini Pro Vision API 的核心凭证。 |
| **`GEMINI_MODEL`** | `例如：gemini-1.5-flash` | 文本 | 指定要使用的 Gemini AI 模型名称。 |
| **`AUTH_TOKEN`** | *自行创建的一个强密码/随机字符串。* | 文本 | 用于保护 `/submit` 接口，只有提供此令牌才能提交识别任务。 |
| **`API_KEY`** | *自行创建的另一个强密码/随机字符串。* | 文本 | 用于保护 `/result` 接口，只有提供此密钥才能查询任务结果。 |

3.  完成所有变量配置后，点击 **Save**。

#### **第 4 步：完成和测试**

部署已经完成！现在，访问你的 Worker URL (`https://<你的Worker名称>.<你的子域>.workers.dev`)，你应该能看到项目自带的 “验证码识别&使用教程” 页面。你可以直接在这个页面上填入你刚刚设置的 `AUTH_TOKEN` 和 `API_KEY`，然后上传一张验证码图片进行测试。

-----


-----

### **API 使用与集成教程**

此 API 服务采用异步处理模式，调用过程分为两步，以确保客户端无需长时间等待 AI 处理结果：

1.  **提交任务**：你首先需要向 `/submit` 端点发送一个包含图片数据的 `POST` 请求。服务会立即验证你的请求并返回一个唯一的任务ID (`taskId`)。
2.  **查询结果**：然后，你需要使用这个 `taskId`，通过轮询（即，每隔几秒钟查询一次）`/result` 端点来获取最终的识别结果。

#### **1. 提交识别任务 (`/submit`)**

  * **Endpoint**: `/submit`
  * **Method**: `POST`
  * **URL**: `https://<你的Worker地址>/submit`
  * **Headers**:
      * `Authorization`: `Bearer <你的AUTH_TOKEN>`
      * `Content-Type`: `application/json`
  * **Body** (JSON 格式):
    ```json
    {
      "image": "<Base64编码后的图片数据>",
      "mimeType": "<图片的MIME类型, e.g., 'image/png' or 'image/jpg' or 'image/jpeg' or 'image/webp'>"
    }
    ```
  * **成功响应** (HTTP 200):
    服务会返回一个包含任务ID的JSON对象。
    ```json
    {
      "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
    ```

#### **2. 查询识别结果 (`/result`)**

  * **Endpoint**: `/result`
  * **Method**: `GET`
  * **URL**: `https://<你的Worker地址>/result?taskId=<从上一步获取的任务ID>&apiKey=<你的API_KEY>`
  * **成功响应** (HTTP 200):
      * **当任务完成时**:
        ```json
        {
          "status": "completed",
          "solution": "识别出的结果"
        }
        ```
      * **当任务仍在处理中**:
        ```json
        {
          "status": "pending"
        }
        ```
      * **当任务发生错误时**:
        ```json
        {
          "status": "error",
          "message": "具体的错误信息"
        }
        ```
  * **失败响应** (HTTP 404):
    如果任务ID不存在或已过期，将返回 `Task not found or expired`。

-----

### **调用示例 (Python)**

这是一个完整的 Python 脚本，演示了如何上传图片、提交任务并轮询结果。

```python
import requests
import base64
import time
import mimetypes

# --- 配置 ---
# 替换成你的 Worker 地址
WORKER_URL = "https://your-worker-name.your-subdomain.workers.dev" 
# 替换成你在 Cloudflare 中设置的 AUTH_TOKEN
AUTH_TOKEN = "your_auth_token"  
# 替换成你在 Cloudflare 中设置的 API_KEY
API_KEY = "your_api_key"        
# 替换成你的本地验证码图片路径
IMAGE_PATH = "path/to/your/captcha.png" 

def solve_captcha(image_path):
    """
    调用API来识别验证码。
    """
    # 1. 读取图片并进行Base64编码
    try:
        with open(image_path, "rb") as image_file:
            image_base64 = base64.b64encode(image_file.read()).decode('utf-8')
        # 自动猜测文件的MIME类型
        mime_type = mimetypes.guess_type(image_path)[0]
        if not mime_type:
            raise ValueError("无法确定图片的MIME类型")
    except FileNotFoundError:
        print(f"错误: 文件未找到 at {image_path}")
        return None
    except Exception as e:
        print(f"读取文件时出错: {e}")
        return None

    # 2. 提交任务
    submit_url = f"{WORKER_URL}/submit"
    submit_headers = {
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    submit_payload = {
        "image": image_base64,
        "mimeType": mime_type
    }

    try:
        print("正在提交任务...")
        submit_res = requests.post(submit_url, headers=submit_headers, json=submit_payload, timeout=15)
        submit_res.raise_for_status() # 如果请求失败 (非2xx状态码), 抛出异常
        
        task_id = submit_res.json().get("taskId")
        if not task_id:
            print("错误: 未能从响应中获取 taskId")
            print("响应内容:", submit_res.text)
            return None
        print(f"任务提交成功, Task ID: {task_id}")
        
    except requests.exceptions.RequestException as e:
        print(f"提交任务时出错: {e}")
        return None

    # 3. 轮询结果
    result_url = f"{WORKER_URL}/result?taskId={task_id}&apiKey={API_KEY}"
    max_polls = 30  # 最多轮询30次 (30 * 2秒 = 60秒超时)
    poll_interval = 2 # 每次轮询间隔2秒

    print("开始轮询结果...")
    for i in range(max_polls):
        try:
            result_res = requests.get(result_url, timeout=10)
            
            if result_res.status_code == 404:
                print("错误: 任务未找到或已过期。")
                return None
            result_res.raise_for_status()
            
            data = result_res.json()
            status = data.get("status")

            if status == "completed":
                solution = data.get("solution")
                print(f"识别成功! 结果: {solution}")
                return solution
            elif status == "error":
                message = data.get("message", "未知错误")
                print(f"识别失败: {message}")
                return None
            elif status == "pending":
                print(f"任务仍在处理中... ({i+1}/{max_polls})")
                time.sleep(poll_interval) # 等待后继续轮询
            else:
                print(f"收到未知的状态: {status}")
                return None

        except requests.exceptions.RequestException as e:
            print(f"查询结果时出错: {e}")
            return None
            
    print("轮询超时，未能获取结果。")
    return None

if __name__ == "__main__":
    captcha_solution = solve_captcha(IMAGE_PATH)
    if captcha_solution:
        print(f"\n[+] 最终识别结果是: {captcha_solution}")

```
