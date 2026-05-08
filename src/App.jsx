import { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import locales from './locales';

const MAX_WIDTH = 1024;
const QUALITY = 0.6;
const API_TIMEOUT = 120000;

function formatReasoning(text) {
  // Remove common markdown artifacts the AI might leak
  let cleaned = text
    .replace(/^#{1,3}\s+/gm, '')           // ### headers
    .replace(/^[\-\*\•]\s+/gm, '')          // - * bullet lists
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // **bold**
    .replace(/\*(.+?)\*/g, '<em>$1</em>')   // *italic*
    .replace(/`(.+?)`/g, '$1')              // `code`
    .replace(/\n{2,}/g, '\n\n');            // normalize multi-newlines

  const parts = cleaned.split(/(?<=\n|^)(?=\d+[\.\、]|第[一-龥]+步)/m);
  if (parts.length <= 1) {
    return cleaned.split('\n').filter(Boolean).map((p, i) =>
      <p key={i} dangerouslySetInnerHTML={{ __html: p }} />
    );
  }
  return parts.filter(Boolean).map((part, i) => {
    const trimmed = part.trim();
    const withBr = trimmed.replace(/\n+/g, '<br/>');
    return <p key={i} dangerouslySetInnerHTML={{ __html: withBr }} />;
  });
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = locales[lang];

  const [imagePath, setImagePath] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const resultRef = useRef(null);
  const abortRef = useRef(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [saveImageUrl, setSaveImageUrl] = useState(null);
  const [showWechatHint, setShowWechatHint] = useState(false);
  const [hideButtons, setHideButtons] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const tips = t.loadingTips;
    setTipIndex(Math.floor(Math.random() * tips.length));
    const timer = setInterval(() => {
      setTipIndex(Math.floor(Math.random() * tips.length));
    }, 2500);
    return () => clearInterval(timer);
  }, [loading, t]);

  useEffect(() => {
    if (!showWechatHint) return;
    const timer = setTimeout(() => {
      setShowWechatHint(false);
      setHideButtons(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [showWechatHint]);

  useEffect(() => {
    return () => { if (saveImageUrl) URL.revokeObjectURL(saveImageUrl); };
  }, [saveImageUrl]);

  function toggleLang() {
    setLang(l => l === 'zh' ? 'en' : 'zh');
  }

  function reset() {
    if (abortRef.current) abortRef.current.abort();
    setImagePath(null);
    setImageBase64(null);
    setLoading(false);
    setStreamingText('');
    setError(null);
    setResult(null);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setImagePath(objectUrl);
    setError(null);
    setResult(null);
    setStreamingText('');

    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      let targetW = width;
      let targetH = height;

      if (width > MAX_WIDTH) {
        targetW = MAX_WIDTH;
        targetH = Math.round((height * MAX_WIDTH) / width);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);

      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = reader.result.split(',')[1];
          setImageBase64(b64);
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', QUALITY);

      const compressed = canvas.toDataURL('image/jpeg', QUALITY);
      URL.revokeObjectURL(objectUrl);
      setImagePath(compressed);
    };
    img.src = objectUrl;
  }

  async function analyze() {
    if (!imageBase64) {
      setError(t.errorNoImage);
      return;
    }

    setLoading(true);
    setStreamingText('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, lang }),
        signal: controller.signal
      });

      if (!resp.ok) {
        setError(`${t.errorDefault} (HTTP ${resp.status})`);
        setLoading(false);
        return;
      }

      const isSSE = resp.headers.get('Content-Type')?.includes('text/event-stream');

      if (isSSE) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          buffer += chunk;

          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const eventStr = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            if (!eventStr.trim()) continue;

            const eventMatch = eventStr.match(/^event:\s*(\S+)$/m);
            const dataMatch = eventStr.match(/^data:\s*(.+)$/m);
            if (!eventMatch || !dataMatch) continue;

            const eventType = eventMatch[1];
            const dataStr = dataMatch[1];

            if (eventType === 'content') {
              try { const { text } = JSON.parse(dataStr); setStreamingText(prev => prev + text); } catch {}
            } else if (eventType === 'done') {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.success && parsed.data) {
                  if (parsed.data.hasPerson === false) {
                    setError(t.errorNoPerson);
                  } else {
                    setResult(parsed.data);
                  }
                } else { setError(parsed.error || t.errorDefault); }
              } catch { setError(t.errorParse); }
              setLoading(false);
              return;
            } else if (eventType === 'error') {
              try { setError(JSON.parse(dataStr).error || t.errorDefault); } catch { setError(t.errorDefault); }
              setLoading(false);
              return;
            }
          }
        }

        setError(t.errorStreamEnd);
        setLoading(false);
        return;
      }

      // Plain JSON response (Vercel production)
      const data = await resp.json();
      if (data.success && data.data) {
        if (data.data.hasPerson === false) {
          setError(t.errorNoPerson);
        } else {
          setResult(data.data);
        }
      } else {
        setError(data.error || t.errorDefault);
      }
      setLoading(false);
    } catch (e) {
      if (e.name === 'AbortError') {
        setLoading(false);
        return;
      }
      // Distinguish timeout vs network error
      const msg = e.name === 'TypeError' && e.message === 'Failed to fetch'
        ? t.errorNetwork
        : `${t.errorDefault} (${e.message || e.name})`;
      setError(msg);
      setLoading(false);
    }
  }

  function retry() {
    setError(null);
    analyze();
  }

  async function handleSave() {
    if (!result) return;

    const CARD_W = 1080;
    const PAD = 60;

    const P_STYLE = 'font-size:22px;font-weight:400;line-height:1.6;color:rgba(0,0,0,0.8);margin:0 0 20px;';

    const reasoningHtml = result.reasoning
      ? '<p style="' + P_STYLE + '">' + result.reasoning
          .replace(/^#{1,3}\s+/gm, '')
          .replace(/^[\-\*\•]\s+/gm, '')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '$1')
          .replace(/\n\n/g, '</p><p style="' + P_STYLE + '">')
          .replace(/\n/g, '<br/>')
        + '</p>'
      : '';

    const photoHtml = imagePath
      ? `<div style="padding:${PAD}px ${PAD}px 0;display:flex;justify-content:center;">
           <img src="${imagePath}" style="max-width:100%;max-height:520px;width:auto;height:auto;border-radius:8px;" onload="document.title='loaded'" />
         </div>`
      : '';

    const reasoningSection = result.reasoning
      ? `<div style="margin-bottom:24px;">
           <p style="font-size:20px;font-weight:600;color:rgba(0,0,0,0.48);margin:0 0 12px;text-transform:uppercase;letter-spacing:-0.12px;">${t.resultReasoning}</p>
           ${reasoningHtml}
         </div>`
      : '';

    const cardHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',sans-serif;color:#1d1d1f;margin:0;background:#fff;width:${CARD_W}px;}
    </style></head><body>
      <div style="background:#000;color:#fff;padding:${PAD}px;text-align:center;">
        <p style="font-size:24px;font-weight:400;color:rgba(255,255,255,0.7);margin:0 0 12px;letter-spacing:-0.24px;">${t.resultLabel}</p>
        <span style="font-size:160px;font-weight:600;line-height:1.07;letter-spacing:-0.28px;">${result.legLengthCm}</span>
        <span style="font-size:48px;font-weight:400;color:rgba(255,255,255,0.7);margin-left:8px;">cm</span>
      </div>
      ${photoHtml}
      <div style="padding:${PAD}px;">
        <div style="margin-bottom:24px;">
          <p style="font-size:20px;font-weight:600;color:rgba(0,0,0,0.48);margin:0 0 8px;text-transform:uppercase;letter-spacing:-0.12px;">${t.resultReference}</p>
          <p style="font-size:28px;font-weight:400;color:#1d1d1f;margin:0;line-height:1.47;">${result.referenceObject}</p>
        </div>
        ${reasoningSection}
      </div>
      <div style="text-align:center;padding:${PAD}px ${PAD}px ${PAD}px;font-size:18px;font-weight:400;color:rgba(0,0,0,0.3);line-height:1.6;">
        腿腿 · Leggy<br/>
        <span style="font-size:14px;">leglegweb.vercel.app</span>
      </div>
    </body></html>`;

    // Use iframe for isolated 1080px viewport — ensures full rendering on mobile
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;top:0;left:0;width:${CARD_W}px;height:100vh;z-index:99998;border:none;`;

    const cover = document.createElement('div');
    cover.style.cssText = `position:fixed;top:0;left:0;width:${CARD_W}px;height:100vh;z-index:99999;background:#f5f5f7;`;

    document.body.appendChild(iframe);
    document.body.appendChild(cover);

    const doc = iframe.contentDocument;
    doc.write(cardHtml);
    doc.close();

    // Wait for image to load (if present)
    if (imagePath) {
      await new Promise(resolve => {
        const img = doc.querySelector('img');
        if (!img) return resolve();
        if (img.complete) return resolve();
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 3000);
      });
    }

    const actualH = doc.body.offsetHeight;

    const cleanup = () => {
      try { document.body.removeChild(iframe); } catch {}
      try { document.body.removeChild(cover); } catch {}
    };

    try {
      const canvas = await html2canvas(doc.body, {
        backgroundColor: '#ffffff',
        width: CARD_W,
        height: actualH,
        scale: 2,
        useCORS: true,
        allowTaint: true
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      cleanup();

      if (!blob) return;

      const file = new File([blob], `${t.saveFilename}_${result.legLengthCm}cm.png`, { type: 'image/png' });

      const isWechat = /MicroMessenger/i.test(navigator.userAgent);

      if (isWechat) {
        const url = URL.createObjectURL(blob);
        if (saveImageUrl) URL.revokeObjectURL(saveImageUrl);
        setSaveImageUrl(url);
        setShowWechatHint(true);
        setHideButtons(false);
        return;
      }

      // Browser/Desktop: download directly
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      cleanup();
      console.error('Save failed:', e);
    }
  }

  // --- State rendering ---

  // Loading / Streaming
  if (loading) {
    return (
      <>
        <Nav t={t} lang={lang} onToggleLang={toggleLang} />
        <main className="section">
          <div className="streaming-container">
            <div className="loading-image-wrap">
              {imagePath && <img className="loading-image" src={imagePath} alt="" />}
              <div className="magnifier">
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="26" cy="26" r="18" stroke="currentColor" strokeWidth="3.5"/>
                  <path d="M40 40l14 14" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <p className="loading-text">{t.loadingText}</p>
            <p className="loading-tip">{t.loadingTips[tipIndex]}</p>
          </div>
        </main>
      </>
    );
  }

  // Error
  if (error) {
    return (
      <>
        <Nav t={t} lang={lang} onToggleLang={toggleLang} />
        <main className="section">
          <div className="error-container">
            <div className="error-icon">!</div>
            <h2 className="error-title">{t.errorDefault}</h2>
            <p className="error-message">{error}</p>
            <div style={{ display: 'flex', gap: 16 }}>
              {imageBase64 && (
                <button className="btn-blue" onClick={retry}>{t.btnRetry}</button>
              )}
              <button className="btn-outline" onClick={reset}>{t.btnRetake}</button>
            </div>
          </div>
        </main>
      </>
    );
  }

  // Result
  if (result) {
    return (
      <>
        <Nav t={t} lang={lang} onToggleLang={toggleLang} />
        <main className="section">
          <div className="result-container">
            {hideButtons && saveImageUrl ? (
              <img src={saveImageUrl} alt="" style={{ display: 'block', width: '100%', borderRadius: 12 }} />
            ) : (
              <>
                <div ref={resultRef} className="result-screenshot">
                  <div className="result-header">
                    <p className="result-label">{t.resultLabel}</p>
                    <div>
                      <span className="result-value">{result.legLengthCm}</span>
                      <span className="result-unit">cm</span>
                    </div>
                  </div>

                  {imagePath && (
                    <div className="result-image-wrap">
                      <img className="result-image" src={imagePath} alt="" crossOrigin="anonymous" />
                    </div>
                  )}

                  <div className="result-body">
                    <div className="result-row">
                      <p className="result-row-label">{t.resultReference}</p>
                      <p className="result-row-value">{result.referenceObject}</p>
                    </div>

                    {result.reasoning && (
                      <div className="result-row">
                        <p className="result-row-label">{t.resultReasoning}</p>
                        <div className="reasoning-text">{formatReasoning(result.reasoning)}</div>
                      </div>
                    )}
                  </div>
                </div>

                {!hideButtons && (
                  <div className="result-actions">
                    <button className="btn-blue" onClick={handleSave}>{t.btnSave}</button>
                    <button className="btn-outline" onClick={reset}>{t.btnRemeasure}</button>
                  </div>
                )}
              </>
            )}
          </div>

          {showWechatHint && (
            <div className="wechat-hint">
              <div className="wechat-hint-arrow">↑</div>
              <p className="wechat-hint-text">{t.saveWechatHint}</p>
            </div>
          )}

        </main>
      </>
    );
  }

  // Image selected (preview)
  if (imagePath) {
    return (
      <>
        <Nav t={t} lang={lang} onToggleLang={toggleLang} />
        <main className="section">
          <div className="preview-container">
            <img className="preview-image" src={imagePath} alt="" />
            <div className="preview-actions">
              <button className="btn-blue" onClick={analyze}>{t.btnAnalyze}</button>
              <button className="btn-outline" onClick={reset}>{t.btnReselect}</button>
            </div>
          </div>
        </main>
      </>
    );
  }

  // Empty state (default)
  return (
    <>
      <Nav t={t} lang={lang} onToggleLang={toggleLang} showLang />

      <section className="hero">
        <h1>{t.heroTitle}</h1>
        <p className="hero-subtitle">{t.heroSubtitle}</p>
      </section>

      <main className="section">
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept="image/*"
          onChange={handleFile}
        />

        <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
          <svg className="upload-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="17" cy="19" r="3" fill="currentColor" />
            <path d="M4 32l10-10 8 8 6-6 16 16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <p className="upload-text">{t.uploadText}</p>
          <p className="upload-hint">{t.uploadHint}</p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.48)', letterSpacing: '-0.224px' }}>
            {t.uploadDisclaimer}
          </p>
        </div>
      </main>

    </>
  );
}

function Nav({ t, lang, onToggleLang, showLang }) {
  return (
    <nav className="nav">
      <span className="nav-title">{t.navTitle}</span>
      {showLang && (
        <button className="lang-switch" onClick={onToggleLang}>
          {lang === 'zh' ? 'EN' : '中'}
        </button>
      )}
    </nav>
  );
}
