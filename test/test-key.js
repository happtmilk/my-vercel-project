import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// 获取当前脚本所在的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 直接强制解析 .env.local 文件
const envPath = path.join(__dirname, '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf8');
  const lines = envFile.split('\n');
  for (const line of lines) {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
  console.log('✅ .env.local 文件已成功手动加载！');
} catch (error) {
  console.error('❌ 找不到 .env.local 文件，请确认文件名正确。');
  process.exit(1);
}

// 检查环境变量是否读取成功
if (!process.env.SILICONFLOW_API_KEY) {
    console.error('❌ 仍未找到环境变量，请检查 .env.local 文件内容！');
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: process.env.SILICONFLOW_BASE_URL,
});

async function testSiliconFlow() {
    try {
        console.log('🚀 正在测试硅基流动 API 连接...');
        const response = await openai.chat.completions.create({
            model: "deepseek-ai/DeepSeek-V4-Flash", 
            messages: [
                { role: "system", content: "你是一个简短的测试助手。" },
                { role: "user", content: "Hello, this is a test. Please reply with 'KEY_WORKS'." }
            ],
        });

        console.log('✅ API 连接成功！');
        console.log('🤖 AI 回复:', response.choices[0].message.content);
            console.log('✅ 密钥读取成功，前8位为:', process.env.SILICONFLOW_API_KEY.slice(0, 8));
    } catch (error) {
        console.error('❌ API 连接失败！请检查报错信息：');
        console.error(error.message);
    }
}

testSiliconFlow();
