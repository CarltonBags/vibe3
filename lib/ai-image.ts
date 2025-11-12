import { OpenAI } from 'openai';
import crypto from 'crypto';

const openai =
  process.env.OPENAI_KEY || process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY,
      })
    : null;

const GRADIENTS = [
  ['#5A31F4', '#FF2D92'],
  ['#2563eb', '#22d3ee'],
  ['#7f5cf3', '#f97316'],
  ['#1f2937', '#0ea5e9'],
  ['#9333ea', '#facc15'],
];

type GenerateImageOptions = {
  description: string;
  sandbox: any;
  requestId?: string;
  size?: '512x512' | '768x768' | '1024x1024';
};

export async function generateAiImageToSandbox({
  description,
  sandbox,
  requestId,
  size = '1024x1024',
}: GenerateImageOptions): Promise<{ src: string; origin: 'ai' | 'gradient' }> {
  if (!sandbox) {
    throw new Error('Sandbox is required to generate AI images');
  }

  await sandbox.fs
    .createFolder('/workspace/public/generated-images', '755')
    .catch(() => {});

  const safeDescription =
    description && description.trim().length > 0
      ? description.trim()
      : 'futuristic neon gradient hero illustration for a web app landing page';

  const prompts = [
    `Ultra-detailed cinematic illustration for a Web3 SaaS landing page. Subject: ${safeDescription}. Render with neon gradients, volumetric lighting, sharp focus, and lots of atmosphere.`,
    `Create a high fidelity, digitally painted hero scene representing ${safeDescription}. Use futuristic colors, depth of field, and dramatic lighting suitable for a modern product website.`,
  ];

  if (openai) {
    for (const prompt of prompts) {
      try {
        const response = await openai.images.generate({
          model: 'gpt-image-1',
          prompt,
          size,
          response_format: 'b64_json',
        });

        const base64 = response.data?.[0]?.b64_json;
        if (base64) {
          const buffer = Buffer.from(base64, 'base64');
          const fileName = `generated-images/${crypto.randomUUID()}.png`;
          await sandbox.fs.uploadFile(buffer, `/workspace/public/${fileName}`);
          console.log(
            `[image:${requestId || 'unknown'}] ✅ Generated AI image for "${safeDescription}" -> ${fileName}`
          );
          return { src: `/${fileName}`, origin: 'ai' };
        }
      } catch (error: any) {
        console.warn(
          `[image:${requestId || 'unknown'}] ⚠️ OpenAI image generation failed (${prompt.slice(
            0,
            60
          )}...):`,
          error?.message || error
        );
      }
    }
  } else {
    console.warn(
      `[image:${requestId || 'unknown'}] ⚠️ OPENAI_KEY not configured; falling back to gradient placeholder.`
    );
  }

  const [startColor, endColor] = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
  const gradientId = `grad_${crypto.randomUUID().replace(/-/g, '')}`;
  const fallbackFile = `generated-images/${crypto.randomUUID()}.svg`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">\n  <defs>\n    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">\n      <stop offset="0%" stop-color="${startColor}"/>\n      <stop offset="100%" stop-color="${endColor}"/>\n    </linearGradient>\n  </defs>\n  <rect width="1600" height="900" fill="url(#${gradientId})"/>\n  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="'Inter', sans-serif" font-size="64" fill="rgba(255,255,255,0.75)">${safeDescription.replace(
    /&/g,
    '&amp;'
  )}</text>\n</svg>`;
  await sandbox.fs.uploadFile(Buffer.from(svg, 'utf-8'), `/workspace/public/${fallbackFile}`);
  console.log(
    `[image:${requestId || 'unknown'}] ✅ Generated gradient placeholder for "${safeDescription}" -> ${fallbackFile}`
  );
  return { src: `/${fallbackFile}`, origin: 'gradient' };
}



