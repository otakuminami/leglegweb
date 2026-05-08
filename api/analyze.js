const SYSTEM_PROMPTS = {
  zh: `你是人体测量分析师。根据照片中人物和参照物估算腿长(髋到脚踝，cm)。

内部参考（推理中只提你实际使用的，严禁罗列此清单）：
门≈200cm、A4纸≈29.7cm、地砖≈60cm、台阶≈15cm、易拉罐≈12cm、篮球≈24cm、手机≈15cm、过膝长靴≈65-70cm、椅子≈45cm

按以下步骤推理，reasoning 每步独立成段、空行分隔、关键数字用**加粗**：
1. 确认人物姿态穿着
2. 找参照物并说明依据
3. 根据参照物推算身高
4. 按身高46-48%估算腿长
5. 结论

最终只输出 JSON（不要\`\`\`包裹）：
{"hasPerson":bool,"legLengthCm":数字,"referenceObject":"参照物","reasoning":"推理","confidence":"high/medium/low"}`,

  en: `You are an anthropometric analyst. Estimate leg length (hip to ankle, in cm) based on the person and reference objects in the photo.

Internal reference (only mention what you actually use, never list this):
Door≈200cm, A4 paper≈29.7cm, floor tile≈60cm, stair step≈15cm, soda can≈12cm, basketball≈24cm, phone≈15cm, knee-high boot≈65-70cm, chair≈45cm

Follow these steps for reasoning. Each step on its own line, separated by blank lines. Bold key numbers with **:
1. Confirm the person's posture and clothing
2. Identify reference objects and explain why you chose them
3. Estimate height based on reference objects
4. Calculate leg length as 46-48% of height
5. Conclusion

Output ONLY JSON (no \`\`\` wrapping):
{"hasPerson":bool,"legLengthCm":number,"referenceObject":"reference object","reasoning":"reasoning","confidence":"high/medium/low"}`
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: '仅支持 POST 请求' });
  }

  const { imageBase64, lang } = req.body;
  const systemPrompt = SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.zh;

  if (!imageBase64) {
    return res.status(400).json({ success: false, error: '请上传图片' });
  }

  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BAILIAN_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen3-vl-flash',
        temperature: 0.1,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
              { type: 'text', text: lang === 'en' ? 'Estimate leg length. Return JSON only.' : '分析腿长，只返回JSON。' }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('OpenRouter error:', errText.slice(0, 1000));
      return res.json({ success: false, error: 'AI 服务暂时不可用' });
    }

    // SSE streaming response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (res.flushHeaders) res.flushHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            res.write(`event: content\ndata: ${JSON.stringify({ text: delta })}\n\n`);
          }
        } catch {}
      }
    }

    if (buffer.startsWith('data: ') && buffer.slice(6) !== '[DONE]') {
      try {
        const parsed = JSON.parse(buffer.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      } catch {}
    }

    try {
      const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const clean = jsonMatch[0].replace(/```json\s*/g, '').replace(/```\s*/g, '');
        const result = JSON.parse(clean);
        res.write(`event: done\ndata: ${JSON.stringify({ success: true, data: result })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: '无法解析AI结果' })}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: '结果解析失败' })}\n\n`);
    }
    res.end();
  } catch (e) {
    console.error('API error:', e.message);
    if (!res.headersSent) {
      res.json({ success: false, error: 'AI 服务暂时不可用' });
    } else {
      try { res.write(`event: error\ndata: ${JSON.stringify({ error: '传输中断' })}\n\n`); } catch {}
      res.end();
    }
  }
}
