// --- 内部固定配置区域 ---
// 这个对象存储了整个 Worker 的核心配置信息。
const CONFIG = {
  // 定义了发送给 Gemini AI 的主要指令文本。
  // 这段文本告诉 AI 如何处理图片中的验证码。
  PROMPT_TEXT: "Analyze the captcha image. If it contains alphanumeric characters, extract the exact string. If it shows a mathematical problem (using +, -, ×, ÷ symbols), calculate the result and return only the final number. The output should always be the raw answer, without any explanation, formatting, or quotes.",

  // Gemini AI 的生成参数配置。
  GENERATION_CONFIG: {
    // "temperature" 控制生成结果的随机性。值越低（如0.1），结果越稳定、越可预测。
    "temperature": 0.1,
    // "maxOutputTokens" 限制了 AI 生成内容的最大长度，防止返回过长的无关文本。
    "maxOutputTokens": 20,
  },
  ICON_URL: "https://github.githubassets.com/favicons/favicon.png",
};

export default {
  /**
   * Cloudflare Worker 的主入口函数。
   * 它会处理所有传入的HTTP请求，并根据请求的路径将其路由到不同的处理函数。
   * @param {Request} request - 传入的请求对象。
   * @param {object} env - Worker 的环境变量，包含API密钥等敏感信息。
   * @param {object} ctx - 执行上下文，用于处理后台任务（如 ctx.waitUntil）。
   * @returns {Promise<Response>} - 返回一个解析为 Response 对象的 Promise。
   */
  async fetch(request, env, ctx) {
    // 将环境变量整合到一个配置对象中，方便后续传递和使用。
    const config = {
      geminiApiKey: env.GEMINI_API_KEY, // Gemini API 的密钥
      geminiModel: env.GEMINI_MODEL,     // 使用的 Gemini 模型名称
      authToken: env.AUTH_TOKEN,         // 提交任务时需要的认证令牌
      apiKey: env.API_KEY,             // 查询结果时需要的认证密钥
      kv: env.RESULTS_KV              // 用于存储任务状态和结果的 KV 命名空间
    };

    // 检查所有必要的环境变量是否都已配置，如果缺少任何一个，则返回500错误。
    for (const key in config) {
      if (!config[key]) {
        return new Response(`Required setting "${key}" is not configured in Worker environment.`, { status: 500 });
      }
    }

    const url = new URL(request.url);
    // 根据请求的路径进行路由分发
    if (url.pathname === '/') {
      // 根路径返回 HTML 用户界面
      return new Response(getHtmlPage(), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' }
      });
    }

    if (url.pathname === '/submit') {
      // '/submit' 路径用于处理新的验证码识别任务提交
      return handleSubmit(request, config, ctx);
    }

    if (url.pathname === '/result') {
      // '/result' 路径用于查询已提交任务的识别结果
      return handleResult(request, config, ctx);
    }

    // 如果路径不匹配，则返回 404 Not Found
    return new Response('Not Found. Use /, /submit or /result.', { status: 404 });
  }
};

// --- 提交处理 ---
/**
 * 处理验证码提交请求 (/submit)。
 * 负责验证请求、创建任务、并将AI识别过程作为后台任务运行。
 * @param {Request} request - 客户端发来的POST请求。
 * @param {object} config - 包含环境变量和KV的配置对象。
 * @param {object} ctx - 执行上下文。
 * @returns {Promise<Response>} - 返回一个解析为 Response 对象的 Promise，其中包含任务ID。
 */
async function handleSubmit(request, config, ctx) {
  // 只接受 POST 方法的请求
  if (request.method !== 'POST') return new Response('Expected POST', { status: 405 });

  // 验证 Authorization 请求头中的 AUTH_TOKEN 是否正确
  const token = request.headers.get('Authorization');
  if (token !== `Bearer ${config.authToken}`) {
    return new Response('Unauthorized: Invalid AUTH_TOKEN', { status: 401 });
  }

  // 解析请求体中的 JSON 数据
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // 校验请求体中是否包含 'image' 和 'mimeType' 字段
  if (!body.image || !body.mimeType) {
    return new Response('Missing "image" or "mimeType" field in JSON body.', { status: 400 });
  }

  // 为新任务生成一个唯一的ID
  const taskId = crypto.randomUUID();
  // 在 KV 中以 'pending' 状态存储任务，并设置300秒的过期时间
  await config.kv.put(taskId, JSON.stringify({ status: 'pending' }), { expirationTtl: 300 });

  // 使用 ctx.waitUntil 确保AI识别任务在后台执行，即使响应已经返回给客户端
  ctx.waitUntil(solveAndStore(taskId, body.image, body.mimeType, config));

  // 立即返回任务ID，让客户端可以轮询结果
  return new Response(JSON.stringify({ taskId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- 查询处理 ---
/**
 * 处理识别结果的查询请求 (/result)。
 * @param {Request} request - 客户端发来的GET请求。
 * @param {object} config - 包含环境变量和KV的配置对象。
 * @returns {Promise<Response>} - 返回一个解析为 Response 对象的 Promise，其中包含存储在KV中的任务状态和结果。
 */
async function handleResult(request, config, ctx) {
  // 只接受 GET 方法的请求
  if (request.method !== 'GET') return new Response('Expected GET', { status: 405 });

  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId'); // 从URL参数中获取任务ID
  const apiKey = url.searchParams.get('apiKey'); // 从URL参数中获取API_KEY

  // 验证 API_KEY 是否正确
  if (apiKey !== config.apiKey) {
    return new Response('Unauthorized: Invalid API_KEY', { status: 401 });
  }

  // 检查是否提供了 taskId
  if (!taskId) return new Response('Missing "taskId" parameter', { status: 400 });

  // 从 KV 中根据 taskId 查询结果
  const result = await config.kv.get(taskId);
  // 如果找不到结果（可能已过期或ID错误），返回 404
  if (!result) return new Response('Task not found or expired', { status: 404 });

  // 返回从 KV 中获取的原始JSON字符串结果
  return new Response(result, { headers: { 'Content-Type': 'application/json' } });
}

// --- AI识别并存储 ---
/**
 * 调用 Gemini AI 进行图片识别，并将结果存储回 KV。
 * 这是一个在后台运行的异步函数。
 * @param {string} taskId - 当前任务的唯一ID。
 * @param {string} imageBase64 - Base64 编码的图片数据。
 * @param {string} mimeType - 图片的 MIME 类型 (e.g., 'image/png')。
 * @param {object} config - 配置对象。
 */
async function solveAndStore(taskId, imageBase64, mimeType, config) {
  // 准备发送给 Gemini API 的请求体 (payload)
  const geminiPayload = {
    contents: [{
      parts: [
        { text: CONFIG.PROMPT_TEXT }, // 指令文本
        { inline_data: { mime_type: mimeType, data: imageBase64 } } // 图片数据
      ]
    }],
    generationConfig: CONFIG.GENERATION_CONFIG // AI生成参数
  };

  // 调用封装好的 Gemini API 请求函数
  const result = await callGemini(config.geminiApiKey, config.geminiModel, geminiPayload);

  // 根据 Gemini 返回的结果，构造最终要存入 KV 的数据对象
  const final = result.error
    ? { status: 'error', message: result.error } // 如果有错，状态为 error
    : { status: 'completed', solution: result.solution }; // 如果成功，状态为 completed

  // 将最终结果（成功或失败）更新到 KV 中，覆盖之前的 'pending' 状态
  await config.kv.put(taskId, JSON.stringify(final), { expirationTtl: 300 });
}

// --- Gemini 请求 ---
/**
 * 封装了对 Google Gemini API 的 fetch 调用。
 * @param {string} apiKey - Gemini API 的密钥。
 * @param {string} model - 使用的模型名称。
 * @param {object} payload - 要发送给 API 的请求体。
 * @returns {Promise<object>} - 返回一个包含 'solution' 或 'error' 的对象。
 */
async function callGemini(apiKey, model, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // 如果API请求失败（HTTP状态码不是2xx），则返回错误信息
  if (!res.ok) {
    return { error: `Gemini API error: ${await res.text()}` };
  }

  // 解析返回的 JSON 数据
  const json = await res.json();
  try {
    // 尝试从复杂的JSON结构中提取出我们需要的识别结果文本
    // 并使用 trim() 去除可能存在的前后空格
    return { solution: json.candidates[0].content.parts[0].text.trim() };
  } catch {
    // 如果解析失败（例如返回的结构不符合预期），则返回一个解析错误
    return { error: 'Failed to parse Gemini response' };
  }
}

// --- HTML 页面 ---
/**
 * 生成并返回前端页面的完整 HTML 代码。
 * @returns {string} - 包含 HTML, CSS, 和 JavaScript 的字符串。
 */
function getHtmlPage() {
  // 使用模板字符串构建动态的 HTML 页面
  return `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证码识别&使用教程</title>
  <link rel="icon" type="image/png" href="https://github.com/ggzhzc/captcha-gemini/blob/main/Image/Image.png?raw=true">
  <style>
    /* CSS样式区域：定义了页面的外观，包括颜色、布局、字体等 */
    :root {
      --primary-color: #4f46e5;
      --primary-hover-color: #4338ca;
      --text-color-dark: #1f2937;
      --text-color-light: #6b7280;
      --bg-color: #f8f9fa;
      --container-bg-color: #ffffff;
      --border-color: #e5e7eb;
      --input-bg-color: #ffffff;
      --code-bg-color: #111827;
      --code-text-color: #d1d5db;
    }

    /* Reset & Base */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color-dark);
      line-height: 1.6;
      display: flex;
      justify-content: center;
      padding: 2rem 1rem;
    }

    .container {
      background-color: var(--container-bg-color);
      max-width: 600px;
      width: 100%;
      padding: 2.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      border: 1px solid var(--border-color);
      position: relative; /* 为GitHub图标的绝对定位提供基准 */
    }
    
    /* GitHub Icon Link */
    .github-link {
        position: absolute;
        top: 2rem;
        right: 2rem;
        line-height: 0;
    }

    .github-link img {
        width: 28px;
        height: 28px;
        transition: opacity 0.2s ease-in-out;
    }

    .github-link:hover img {
        opacity: 0.7;
    }


    /* Typography */
    h2 {
      font-size: 1.75rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 2rem;
    }
    
    label {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-color-dark);
    }
    
    /* Form Elements */
    .form-grid {
        display: grid;
        gap: 1.5rem;
    }
    
    .form-group {
        display: grid;
        gap: 0.5rem;
    }

    input[type="text"],
    input[type="file"] {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 1rem;
      color: var(--text-color-dark);
      background-color: var(--input-bg-color);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    
    input[type="file"] {
        padding: 0.5rem 1rem;
    }
    
    input[type="file"]::file-selector-button {
        margin-right: 1rem;
        border: none;
        background: var(--primary-color);
        padding: 0.5rem 1rem;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }
    
    input[type="file"]::file-selector-button:hover {
        background: var(--primary-hover-color);
    }

    input[type="text"]:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }

    button {
      width: 100%;
      background-color: var(--primary-color);
      border: none;
      border-radius: 8px;
      padding: 0.875rem 0;
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
    }

    button:hover {
      background-color: var(--primary-hover-color);
      transform: translateY(-2px);
    }

    /* Result Box */
    #result {
      margin-top: 2rem;
      padding: 1.25rem;
      border-radius: 8px;
      text-align: center;
      font-size: 1.125rem;
      font-weight: 600;
      background-color: #f3f4f6;
      border: 1px solid var(--border-color);
      word-break: break-all;
      transition: background-color 0.3s ease;
    }
    
    #result #output {
        font-family: 'Courier New', Courier, monospace;
        color: var(--primary-color);
    }

    /* API Documentation */
    .api-doc {
      margin-top: 3rem;
      border-top: 1px solid var(--border-color);
      padding-top: 2rem;
    }

    .api-doc h3 {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 2rem;
    }

    .api-doc h4 {
      font-size: 1.125rem;
      font-weight: 600;
      margin-top: 2rem;
      margin-bottom: 1rem;
      position: relative;
    }

    pre {
      background-color: var(--code-bg-color);
      color: var(--code-text-color);
      border-radius: 8px;
      padding: 1.5rem;
      font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
      font-size: 0.875rem;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.7;
    }
    
    .api-doc p {
        color: var(--text-color-light);
        font-size: 0.9rem;
        text-align: center;
        margin-bottom: 2rem;
    }
    
    code {
        background-color: #e5e7eb;
        color: var(--text-color-dark);
        padding: 0.2em 0.4em;
        border-radius: 4px;
        font-size: 0.85em;
    }

  </style>
</head>
<body>
  <div class="container">
    <a href="https://github.com/ggzhzc/captcha-gemini/tree/main" class="github-link" target="_blank" rel="noopener noreferrer" title="View on GitHub">
        <img src="${CONFIG.ICON_URL}" alt="Project Icon" />
    </a>
    <h2>验证码识别&使用教程</h2>
    <div class="form-grid">
        <div class="form-group">
            <label for="authToken">AUTH_TOKEN</label>
            <input type="text" id="authToken" placeholder="请输入您的 AUTH_TOKEN" autocomplete="off" />
        </div>

        <div class="form-group">
            <label for="apiKey">API_KEY</label>
            <input type="text" id="apiKey" placeholder="请输入您的 API_KEY" autocomplete="off" />
        </div>
        
        <div class="form-group">
            <label for="imageInput">验证码图片</label>
            <input type="file" id="imageInput" accept="image/png,image/jpeg,image/jpg,image/webp" />
        </div>

        <button onclick="submitCaptcha()">提交识别</button>
    </div>

    <div id="result">
      识别结果：<span id="output">等待提交</span>
    </div>

    <div class="api-doc">
      <h3>API 调用说明</h3>
      <p>您可以通过以下接口，将此服务集成到您的应用程序中。</p>

      <div class="api-endpoint">
          <h4>1. 提交识别任务</h4>
          <pre>
URL: /submit
方法: POST
请求头:
  Authorization: Bearer &lt;AUTH_TOKEN&gt;
  Content-Type: application/json

请求体:
{
  "image": "&lt;Base64编码后的图片数据&gt;",
  "mimeType": "&lt;图片的MIME类型, e.g., 'image/png' or 'image/jpeg' or 'image/jpg' or 'image/webp'&gt;"
}
</pre>
      </div>

      <div class="api-endpoint">
          <h4>2. 查询识别结果</h4>
          <pre>
URL: /result?taskId=&lt;任务ID&gt;&apiKey=&lt;API_KEY&gt;
方法: GET

成功返回:
{
  "status": "completed",
  "solution": "&lt;识别结果&gt;"
}
</pre>
      </div>
    </div>
  </div>

  <script>
    /**
     * 当用户点击“提交识别”按钮时触发此函数。
     */
    async function submitCaptcha() {
      // 获取用户在输入框中填写的 AUTH_TOKEN, API_KEY 和选择的文件
      const authToken = document.getElementById('authToken').value.trim();
      const apiKey = document.getElementById('apiKey').value.trim();
      const fileInput = document.getElementById('imageInput');
      const output = document.getElementById('output');

      // 验证关键信息是否已填写
      if (!authToken || !apiKey) {
        output.textContent = "请填写 AUTH_TOKEN 和 API_KEY。";
        return;
      }

      if (!fileInput.files[0]) {
        output.textContent = "请先选择一张图片。";
        return;
      }

      const file = fileInput.files[0];
      const reader = new FileReader();

      // 当文件读取完成后执行
      reader.onloadend = async () => {
        // 将文件读取为 Data URL, 并提取 Base64 部分
        const base64 = reader.result.split(",")[1];
        const mimeType = file.type;
        output.textContent = "正在提交...";

        try {
          // 向 '/submit' 端点发送 POST 请求
          const submitRes = await fetch("/submit", {
            method: "POST",
            headers: {
              Authorization: \`Bearer \${authToken}\`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ image: base64, mimeType: mimeType }),
          });

          // 如果提交失败，显示错误信息
          if (!submitRes.ok) {
            const errText = await submitRes.text();
            output.textContent = "提交失败：" + errText;
            return;
          }

          // 解析返回的 JSON，获取任务 ID
          const { taskId } = await submitRes.json();
          output.textContent = "任务已提交，轮询中...";
          // 开始轮询查询结果
          pollResult(taskId, apiKey);
        } catch (err) {
          output.textContent = "请求错误：" + err.message;
        }
      };

      // 以 Data URL 的格式读取文件
      reader.readAsDataURL(file);
    }

    /**
     * 定期查询任务结果。
     * @param {string} taskId - 要查询的任务ID。
     * @param {string} apiKey - 用于查询认证的 API_KEY。
     */
    async function pollResult(taskId, apiKey) {
      const output = document.getElementById("output");
      let pollCount = 0;
      const maxPolls = 30; // 设置最大轮询次数（30次 * 2秒/次 = 最多等待60秒）

      // 设置一个定时器，每2秒执行一次查询
      const interval = setInterval(async () => {
        pollCount++;
        // 如果超过最大轮询次数，则停止并提示超时
        if (pollCount > maxPolls) {
            output.textContent = '任务超时，请重试或检查后台。';
            clearInterval(interval);
            return;
        }
        
        try {
          // 向 '/result' 端点发送 GET 请求
          const res = await fetch(\`/result?taskId=\${taskId}&apiKey=\${apiKey}\`);
          if (!res.ok) {
            // 如果请求失败，停止轮询并显示错误
            output.textContent = "获取结果失败：" + (await res.text());
            clearInterval(interval);
            return;
          }

          const data = await res.json();
          if (data.status === "completed") {
            // 如果任务完成，显示识别结果并停止轮询
            output.textContent = data.solution;
            clearInterval(interval);
          } else if (data.status === "error") {
            // 如果任务出错，显示错误信息并停止轮询
            output.textContent = \`识别失败：\${data.message}\`;
            clearInterval(interval);
          } else {
            // 如果任务仍在 'pending' 状态，更新提示信息并继续等待下一次轮询
            output.textContent = \`识别中... (\${pollCount})\`;
          }
        } catch (e) {
          // 如果 fetch 本身发生网络等异常，停止轮询并显示错误
          output.textContent = "请求异常：" + e.message;
          clearInterval(interval);
        }
      }, 2000); // 轮询间隔为2000毫秒（2秒）
    }
  </script>
</body>
</html>
  `;
}
